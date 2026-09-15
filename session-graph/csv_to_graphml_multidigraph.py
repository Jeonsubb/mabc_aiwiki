#!/usr/bin/env python3
"""
CSV → MultiDiGraph → GraphML 변환

핵심: nx.MultiDiGraph를 사용하여 같은 두 노드 사이의 여러 관계(is participated by + 요청함 등)를
모두 보존. GraphML 저장 후 재읽기로 원본 CSV와 대조 검증.
"""

import sys
import os
import csv
import re
import hashlib
import ast
import networkx as nx
from pathlib import Path

# 아틀라스 계열 유틸리티 재사용(site-packages에 설치된 atlas_rag를 그대로 사용)
from atlas_rag.kg_construction.utils.csv_processing.csv_to_graphml import (
    get_node_id, sanitize_xml_string, validate_graphml
)

def safe_sanitize(value):
    if value is None:
        return ""
    return sanitize_xml_string(str(value))

def make_graphml(
    triple_node_file,
    text_node_file,
    triple_edge_file,
    text_edge_file,
    concept_node_file=None,
    concept_edge_file=None,
    output_file="kg.graphml",
    include_concept=True,
):
    """
    csvs_to_graphml과 동일하지만 nx.MultiDiGraph를 사용하여
    같은 두 노드 사이의 여러 관계를 모두 보존.

    엣지 키: (start_id, end_id, relation, type) — 이게 고유해야 별도 엣지로 저장
    """
    g = nx.MultiDiGraph()
    entity_to_id = {}

    # 1. triple nodes
    with open(triple_node_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            node_id = row["name:ID"]
            mapped_id = get_node_id(node_id, entity_to_id)
            if mapped_id not in g.nodes:
                g.add_node(mapped_id, id=safe_sanitize(node_id), type=safe_sanitize(row["type"]))

    # 2. text nodes
    with open(text_node_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            node_id = row["text_id:ID"]
            if node_id not in g.nodes:
                g.add_node(safe_sanitize(node_id),
                          file_id=safe_sanitize(node_id),
                          id=safe_sanitize(row["original_text"]),
                          type="passage")

    # 3. concept nodes
    if concept_node_file is not None:
        with open(concept_node_file, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                node_id = row["concept_id:ID"]
                if node_id not in g.nodes:
                    g.add_node(safe_sanitize(node_id),
                              file_id="concept_file",
                              id=safe_sanitize(row["name"]),
                              type="concept")

    # 4. triple edges — MultiDiGraph: 키 기반 멀티엣지
    with open(triple_edge_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            start_id = get_node_id(row[":START_ID"], entity_to_id)
            end_id = get_node_id(row[":END_ID"], entity_to_id)
            relation = safe_sanitize(row["relation"])
            edge_type = safe_sanitize(row[":TYPE"])

            # MultiDiGraph: add_edge는 key를 반환하지 않으므로,
            # 같은 (start, end) 사이에도 다른 relation이면 다른 키로 저장됨
            g.add_edge(start_id, end_id,
                      relation=relation,
                      type=edge_type)

            # 방금 추가한 엣지의 key를 찾는다.
            edge_key = None
            try:
                edge_keys = list(g[start_id][end_id].keys())
                if edge_keys:
                    edge_key = edge_keys[-1]
            except KeyError:
                pass

            if edge_key is not None:
                # concepts 처리 — g[start_id][end_id][edge_key]로 접근
                if include_concept and "concepts" in row:
                    try:
                        concepts_list = ast.literal_eval(row["concepts"])
                        for concept in concepts_list:
                            concept_str = safe_sanitize(concept)
                            edge_data = g[start_id][end_id][edge_key]
                            if "concepts" not in edge_data:
                                edge_data["concepts"] = concept_str
                            else:
                                current = edge_data["concepts"].split(",")
                                if concept_str not in current:
                                    edge_data["concepts"] += "," + concept_str
                    except (ValueError, SyntaxError):
                        pass

                # file_id 처리
                for node_id in [start_id, end_id]:
                    if g.nodes[node_id]['type'] in ['triple', 'concept'] and 'file_id' not in g.nodes[node_id]:
                        g.nodes[node_id]['file_id'] = safe_sanitize(row.get("file_id", "triple_file"))

    # 5. text edges
    with open(text_edge_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            start_id = get_node_id(row[":START_ID"], entity_to_id)
            end_id = safe_sanitize(row[":END_ID"])
            if not g.has_edge(start_id, end_id):
                g.add_edge(start_id, end_id,
                          relation="mention in",
                          type=safe_sanitize(row[":TYPE"]))
                if 'file_id' in g.nodes[start_id]:
                    current = g.nodes[start_id]['file_id']
                    g.nodes[start_id]['file_id'] = safe_sanitize(current + "," + str(end_id))
                else:
                    g.nodes[start_id]['file_id'] = safe_sanitize(str(end_id))

    # 6. concept edges
    if concept_edge_file is not None:
        with open(concept_edge_file, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                start_id = get_node_id(row[":START_ID"], entity_to_id)
                end_id = safe_sanitize(row[":END_ID"])
                if not g.has_edge(start_id, end_id):
                    g.add_edge(start_id, end_id,
                              relation=safe_sanitize(row["relation"]),
                              type=safe_sanitize(row[":TYPE"]))

    # 7. Write GraphML
    output_dir = os.path.dirname(output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)

    try:
        nx.write_graphml(g, output_file, infer_numeric_types=True)
        if validate_graphml(output_file):
            print(f"Successfully created GraphML file: {output_file}")
        else:
            print(f"Failed to create valid GraphML file: {output_file}")
    except Exception as e:
        print(f"Error writing GraphML file: {e}")
        import traceback
        traceback.print_exc()
        try:
            nx.write_graphml(g, output_file, infer_numeric_types=False)
            print(f"Successfully created GraphML file (without numeric inference): {output_file}")
        except Exception as e2:
            print(f"Failed to write GraphML file: {e2}")
            raise

    return g

def read_and_verify(graphml_file, csv_triple_edge_file):
    """
    GraphML을 다시 읽어서 원본 CSV와 대조 검증.
    반환: (gm_edges_set, csv_edges_set, 추출_통계)
    """
    # GraphML 읽기
    g = nx.read_graphml(graphml_file)

    # MultiDiGraph가 아니면 변환
    if not isinstance(g, nx.MultiDiGraph):
        g = nx.MultiDiGraph(g)

    # 노드 이름 → GraphML ID 매핑 (역방향: hash → name)
    gid_to_name = {}
    for node_id, data in g.nodes(data=True):
        name = data.get('id', '')
        gid_to_name[node_id] = name

    # GraphML 엣지 수집
    gm_edges = set()
    gm_stats = {'total': 0, 'with_concepts': 0, 'relation_type': 0, 'concept_type': 0, 'source_type': 0}

    for u, v, key, data in g.edges(data=True, keys=True):
        src_name = gid_to_name.get(u, u)
        tgt_name = gid_to_name.get(v, v)

        rel = data.get('relation', '')
        typ = data.get('type', '')
        concepts = data.get('concepts', '')

        gm_edges.add((src_name, tgt_name, rel, typ, concepts))
        gm_stats['total'] += 1
        if concepts:
            gm_stats['with_concepts'] += 1
        if typ == 'Relation':
            gm_stats['relation_type'] += 1
        elif typ == 'Concept':
            gm_stats['concept_type'] += 1
        elif typ == 'Source':
            gm_stats['source_type'] += 1

    # CSV 엣지 수집
    csv_edges = set()
    csv_stats = {'total': 0, 'with_concepts': 0}
    csv_edges_concepts_normalized = set()  # concepts 정규화 버전

    with open(csv_triple_edge_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            src = row[":START_ID"]
            tgt = row[":END_ID"]
            rel = row["relation"]
            typ = row[":TYPE"]
            concepts_raw = row.get("concepts", "")
            csv_edges.add((src, tgt, rel, typ, concepts_raw))
            csv_stats['total'] += 1
            if concepts_raw and concepts_raw != '[]':
                csv_stats['with_concepts'] += 1
                # concepts 정규화: 파싱해서 집합으로
                try:
                    concepts_set = frozenset(ast.literal_eval(concepts_raw))
                    csv_edges_concepts_normalized.add((src, tgt, rel, typ, concepts_set))
                except (ValueError, SyntaxError, TypeError):
                    csv_edges_concepts_normalized.add((src, tgt, rel, typ, frozenset()))

    # CSV only 비교: concepts 정규화 버전으로
    csv_only_normalized = set()
    for (s, t, r, tp, cset) in csv_edges_concepts_normalized:
        # GM에서 이 엣지가 concepts 정규화로 존재하는지 확인
        found = False
        for (gs, gt, gr, gtTp, gcStr) in gm_edges:
            if s == gs and t == gt and r == gr and tp == gtTp:
                # concepts 비교: GM의 concepts를 파싱
                if gcStr:
                    try:
                        gm_concepts_set = frozenset(gcStr.split(','))
                    except:
                        gm_concepts_set = frozenset()
                else:
                    gm_concepts_set = frozenset()
                if cset == gm_concepts_set:
                    found = True
                    break
        if not found:
            csv_only_normalized.add((s, t, r, tp, cset))

    # GM only 비교: concepts 정규화 버전으로
    gm_only_normalized = set()
    for (s, t, r, tp, gcStr) in gm_edges:
        if gcStr:
            try:
                gm_concepts_set = frozenset(gcStr.split(','))
            except:
                gm_concepts_set = frozenset()
        else:
            gm_concepts_set = frozenset()
        # CSV에서 이 엣지가 concepts 정규화로 존재하는지 확인
        found = False
        for (cs, ct, cr, ctTp, cset) in csv_edges_concepts_normalized:
            if s == cs and t == ct and r == cr and tp == ctTp:
                if gm_concepts_set == cset:
                    found = True
                    break
        if not found:
            gm_only_normalized.add((s, t, r, tp, gm_concepts_set))

    # concepts 누락: CSV에는 concepts가 있는데 GM에는 없거나 다른 경우
    # = CSV only_normalized 중에서 concepts가 있는 것들
    missing_concepts = set()
    for (s, t, r, tp, cset) in csv_only_normalized:
        if cset:  # concepts가 있는 경우
            missing_concepts.add((s, t, r, tp, cset))

    print(f"  매칭 (CSV ∩ GM): {len(csv_edges) - len(csv_only_normalized)}")
    print(f"  CSV only (GM에 없음): {len(csv_only_normalized)}")
    print(f"  GM only (CSV에 없음): {len(gm_only_normalized)}")
    print()

    # CSV only 상세
    if csv_only_normalized:
        print("  [CSV only] — GraphML에 누락된 CSV 엣지:")
        for (src, tgt, rel, typ, concepts_set) in sorted(csv_only_normalized):
            concepts_str = ",".join(sorted(concepts_set)) if concepts_set else ""
            print(f"    {src} --({rel}) [type={typ}]--> {tgt}")
            print(f"      concepts: {concepts_str[:100]}")
        print()

    # GM only 상세
    if gm_only_normalized:
        print(f"  [GM only] — CSV에 없는 GraphML 엣지 ({len(gm_only_normalized)}건, 개념/출처 연결 등):")
        concept_only = [e for e in gm_only_normalized if e[3] in ('Concept', 'Source')]
        relation_only = [e for e in gm_only_normalized if e[3] == 'Relation']
        print(f"    Relation 타입 (CSV와 비교 필요): {len(relation_only)}건")
        print(f"    Concept/Source 타입 (추가 그래프 구조): {len(concept_only)}건")
        if relation_only:
            for (src, tgt, rel, typ, concepts_set) in sorted(relation_only)[:5]:
                concepts_str = ",".join(sorted(concepts_set)) if concepts_set else ""
                print(f"      {src} --({rel}) [type={typ}]--> {tgt}")
                if concepts_str:
                    print(f"        concepts: {concepts_str[:80]}")
        print()

    # concepts 보존 확인
    if missing_concepts:
        print(f"  [FAIL] concepts 누락: {len(missing_concepts)}건")
        for (s, t, r, tp, cset) in list(missing_concepts)[:5]:
            concepts_str = ",".join(sorted(cset))
            print(f"    {s} --({r})--> {t}: {concepts_str[:80]}")
    else:
        print(f"  [PASS] CSV의 모든 concepts가 GraphML에 보존됨")

    return gm_edges, csv_edges, gm_stats, csv_stats

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="CSV → MultiDiGraph → GraphML 변환 및 검증")
    parser.add_argument("--session", required=True, help="세션 ID (예: session_kr_002)")
    parser.add_argument("--base", default="concept_output_sessions", help="베이스 디렉토리")
    parser.add_argument("--output-name", default=None, help="출력 파일명 (기본: kg_with_concept_v2.graphml)")
    args = parser.parse_args()

    sid = args.session
    base = args.base
    output_name = args.output_name or f"kg_with_concept_v2.graphml"
    output_file = os.path.join(base, sid, output_name)

    print(f"=== {sid} MultiDiGraph GraphML 생성 ===")
    print()

    # 경로 설정
    triple_node_file = os.path.join(base, sid, "csv", f"triple_nodes_{sid}_from_json_without_emb.csv")
    text_node_file = os.path.join(base, sid, "csv", f"text_nodes_{sid}_from_json.csv")
    triple_edge_file = os.path.join(base, sid, "concept_csv_processed", "full_concept_triple_edges.csv")
    text_edge_file = os.path.join(base, sid, "csv", f"text_edges_{sid}_from_json.csv")
    concept_node_file = os.path.join(base, sid, "concept_csv_processed", "concept_nodes.csv")
    concept_edge_file = os.path.join(base, sid, "concept_csv_processed", "concept_edges.csv")

    for f, label in [(triple_node_file, "triple_node"),
                     (text_node_file, "text_node"),
                     (triple_edge_file, "triple_edge"),
                     (text_edge_file, "text_edge"),
                     (concept_node_file, "concept_node"),
                     (concept_edge_file, "concept_edge")]:
        if not os.path.exists(f):
            print(f"  [WARN] {label} 없음: {f}")

    print(f"  triple_node: {triple_node_file}")
    print(f"  triple_edge: {triple_edge_file}")
    print()

    # 1. GraphML 생성
    print("1. GraphML 생성 중...")
    g = make_graphml(
        triple_node_file=triple_node_file,
        text_node_file=text_node_file,
        triple_edge_file=triple_edge_file,
        text_edge_file=text_edge_file,
        concept_node_file=concept_node_file,
        concept_edge_file=concept_edge_file,
        output_file=output_file,
        include_concept=True,
    )

    if not os.path.exists(output_file):
        print(f"  [ERROR] GraphML 생성 실패: {output_file}")
        sys.exit(1)

    print(f"  출력: {output_file} ({os.path.getsize(output_file)} bytes)")
    print()

    # 2. 재읽기 및 검증
    print("2. 재읽기 및 원본 CSV 대조 검증...")
    gm_edges, csv_edges, gm_stats, csv_stats = read_and_verify(output_file, triple_edge_file)

    print(f"  CSV 고유 트리플: {csv_stats['total']} (concepts 있음: {csv_stats['with_concepts']})")
    print(f"  GraphML 고유 트리플: {gm_stats['total']} (concepts 있음: {gm_stats['with_concepts']})")
    print(f"  GraphML 타입별: Relation={gm_stats['relation_type']}, Concept={gm_stats['concept_type']}, Source={gm_stats['source_type']}")
    print()

    # 매칭 비교
    matched = gm_edges & csv_edges
    csv_only = csv_edges - gm_edges
    gm_only = gm_edges - csv_edges

    print(f"  매칭 (CSV ∩ GM): {len(matched)}")
    print(f"  CSV only (GM에 없음): {len(csv_only)}")
    print(f"  GM only (CSV에 없음): {len(gm_only)}")
    print()

    # CSV only 상세
    if csv_only:
        print("  [CSV only] — GraphML에 누락된 CSV 엣지:")
        for (src, tgt, rel, typ, concepts) in sorted(csv_only):
            print(f"    {src} --({rel}) [type={typ}]--> {tgt}")
            print(f"      concepts: {concepts[:100]}")
        print()

    # GM only 상세 (무시 가능한 것들 제외)
    if gm_only:
        print(f"  [GM only] — CSV에 없는 GraphML 엣지 ({len(gm_only)}건, 개념/출처 연결 등):")
        # 개념/Source 엣지는 무시 가능한 것들
        concept_only = [e for e in gm_only if e[3] in ('Concept', 'Source')]
        relation_only = [e for e in gm_only if e[3] == 'Relation']
        print(f"    Relation 타입 (CSV와 비교 필요): {len(relation_only)}건")
        print(f"    Concept/Source 타입 (추가 그래프 구조): {len(concept_only)}건")
        if relation_only:
            for (src, tgt, rel, typ, concepts) in sorted(relation_only)[:5]:
                print(f"      {src} --({rel}) [type={typ}]--> {tgt}")
                if concepts:
                    print(f"        concepts: {concepts[:80]}")
        print()

    # concepts 보존 확인
    csv_with_concepts = {(s, t, r, tp, c) for (s, t, r, tp, c) in csv_edges if c and c != '[]'}
    gm_with_concepts = {(s, t, r, tp, c) for (s, t, r, tp, c) in gm_edges if c}

    missing_concepts = csv_with_concepts - gm_with_concepts
    if missing_concepts:
        print(f"  [FAIL] concepts 누락: {len(missing_concepts)}건")
        for (s, t, r, tp, c) in list(missing_concepts)[:5]:
            print(f"    {s} --({r})--> {t}: {c[:80]}")
    else:
        print(f"  [PASS] CSV의 모든 concepts가 GraphML에 보존됨")

    print()
    print(f"=== 완료: {output_file} ===")
