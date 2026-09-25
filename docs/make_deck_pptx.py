# -*- coding: utf-8 -*-
"""Nodus PRD v0.2 → PPTX (16:9, 단색 + 초록 로고)"""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
import os

OUT = os.path.expanduser("~/Downloads/Nodus-발표자료.pptx")
ASSETS = os.path.expanduser("~/mabc_aiwiki-ui-integration/docs/poster-assets/")

INK = RGBColor(0x14, 0x18, 0x1C); BODY = RGBColor(0x14, 0x18, 0x1C); MUTE = RGBColor(0x14, 0x18, 0x1C)
FAINT = RGBColor(0x14, 0x18, 0x1C); LINE = RGBColor(0xCF, 0xD5, 0xDA); PANEL = RGBColor(0xF3, 0xF5, 0xF6)
PANEL2 = RGBColor(0xEC, 0xEF, 0xF1); WHITE = RGBColor(0xFF, 0xFF, 0xFF); GREEN = RGBColor(0x2F, 0x8F, 0x7A)
FONT = "Apple SD Gothic Neo"

prs = Presentation()
prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]
W = 13.333

def txt(slide, x, y, w, h, text, size=14, bold=False, color=BODY, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, font=FONT, line=1.15):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True; tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Inches(0.05); tf.margin_top = tf.margin_bottom = Inches(0.03)
    lines = text if isinstance(text, list) else [text]
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align; p.line_spacing = line
        r = p.add_run(); r.text = ln
        r.font.size = Pt(size); r.font.bold = bold; r.font.color.rgb = color; r.font.name = font
    return tb

def bullets(slide, x, y, w, h, items, size=13, color=BODY, gap=6):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.05)
    for i, it in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(gap); p.line_spacing = 1.15
        if isinstance(it, tuple):
            r = p.add_run(); r.text = "•  " + it[0]; r.font.bold = True; r.font.size = Pt(size); r.font.color.rgb = INK; r.font.name = FONT
            r2 = p.add_run(); r2.text = " " + it[1]; r2.font.size = Pt(size); r2.font.color.rgb = color; r2.font.name = FONT
        else:
            r = p.add_run(); r.text = "•  " + it; r.font.size = Pt(size); r.font.color.rgb = color; r.font.name = FONT
    return tb

def rect(slide, x, y, w, h, fill=PANEL, line=None, radius=True):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    if radius:
        shp.adjustments[0] = 0.06
    shp.fill.solid(); shp.fill.fore_color.rgb = fill
    if line is None: shp.line.fill.background()
    else: shp.line.color.rgb = line; shp.line.width = Pt(0.75)
    shp.shadow.inherit = False
    return shp

def logo(slide, x, y, s=0.42, color=GREEN):
    """세 점을 잇는 노드 로고 (초록)"""
    def dot(cx, cy, r):
        d = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x + cx*s - r*s), Inches(y + cy*s - r*s), Inches(2*r*s), Inches(2*r*s))
        d.fill.background(); d.line.color.rgb = color; d.line.width = Pt(2.2); d.shadow.inherit = False
    def seg(x1, y1, x2, y2):
        c = slide.shapes.add_connector(1, Inches(x + x1*s), Inches(y + y1*s), Inches(x + x2*s), Inches(y + y2*s))
        c.line.color.rgb = color; c.line.width = Pt(2.2)
    dot(0.33, 0.40, 0.095); dot(0.67, 0.29, 0.095); dot(0.58, 0.65, 0.095)
    seg(0.42, 0.41, 0.58, 0.32); seg(0.67, 0.38, 0.62, 0.57)

def header(slide, num, title, sub=None):
    logo(slide, 0.55, 0.42, s=0.5)
    txt(slide, 1.15, 0.38, 0.9, 0.5, num, size=12, bold=True, color=MUTE, font="Menlo")
    txt(slide, 1.15, 0.62, 10.5, 0.7, title, size=26, bold=True, color=INK)
    if sub: txt(slide, 1.17, 1.28, 11.5, 0.5, sub, size=13, color=MUTE)
    ln = slide.shapes.add_connector(1, Inches(0.6), Inches(1.78), Inches(W-0.6), Inches(1.78)); ln.line.color.rgb = INK; ln.line.width = Pt(1.25)
    # footer
    txt(slide, 0.6, 7.05, 6, 0.3, "Nodus · MABC 2026 결선 발표", size=9, color=FAINT)
    txt(slide, W-3.6, 7.05, 3.0, 0.3, "MABC 2026 결선 · Let's do well", size=9, color=FAINT, align=PP_ALIGN.RIGHT)

def table(slide, x, y, w, rows, col_w=None, size=11, head_fill=PANEL2, row_h=0.42):
    nrows, ncols = len(rows), len(rows[0])
    gt = slide.shapes.add_table(nrows, ncols, Inches(x), Inches(y), Inches(w), Inches(row_h*nrows)).table
    if col_w:
        for i, cw in enumerate(col_w): gt.columns[i].width = Inches(cw)
    for r, row in enumerate(rows):
        for c, val in enumerate(row):
            cell = gt.cell(r, c); cell.text = ""
            cell.margin_left = cell.margin_right = Inches(0.08); cell.margin_top = cell.margin_bottom = Inches(0.05)
            p = cell.text_frame.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; run = p.add_run(); run.text = str(val)
            run.font.size = Pt(size); run.font.name = FONT
            run.font.bold = (r == 0); run.font.color.rgb = INK if r == 0 else BODY
            cell.fill.solid(); cell.fill.fore_color.rgb = head_fill if r == 0 else (WHITE if r % 2 else RGBColor(0xFA, 0xFB, 0xFB))
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
    return gt

def card(slide, x, y, w, h, eyebrow, title, body, fill=PANEL, title_size=15, body_size=11.5):
    rect(slide, x, y, w, h, fill=fill, line=LINE)
    if eyebrow: txt(slide, x+0.18, y+0.14, w-0.36, 0.3, eyebrow, size=9.5, bold=True, color=MUTE, font="Menlo")
    txt(slide, x+0.18, y+(0.42 if eyebrow else 0.16), w-0.36, 0.6, title, size=title_size, bold=True, color=INK)
    if body:
        if isinstance(body, list):
            bullets(slide, x+0.12, y+(0.98 if eyebrow else 0.72), w-0.3, h-1.0, body, size=body_size, gap=3)
        else:
            txt(slide, x+0.18, y+(0.98 if eyebrow else 0.72), w-0.36, h-1.0, body, size=body_size, color=BODY, line=1.25)

def flow(slide, y, steps, h=1.55, x0=0.6, gap=0.18):
    n = len(steps); w = (W - 2*x0 - gap*(n-1)) / n
    for i, (kind, t, d) in enumerate(steps):
        x = x0 + i*(w+gap)
        dark = kind == "human"
        rect(slide, x, y, w, h, fill=INK if dark else PANEL, line=None if dark else LINE)
        b = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x+0.18), Inches(y+0.19), Inches(0.26), Inches(0.26))
        b.fill.solid(); b.fill.fore_color.rgb = WHITE if dark else INK; b.line.fill.background(); b.shadow.inherit = False
        tf = b.text_frame; tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; r = p.add_run(); r.text = str(i+1); r.font.size = Pt(9); r.font.bold = True; r.font.color.rgb = INK if dark else WHITE; r.font.name = "Menlo"
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        txt(slide, x+0.5, y+0.12, w-0.62, 0.4, t, size=14, bold=True, color=WHITE if dark else INK)
        txt(slide, x+0.18, y+0.62, w-0.36, h-0.7, d, size=10.5, color=RGBColor(0xE6,0xE9,0xEB) if dark else BODY, line=1.2)
        if i < n-1:
            txt(slide, x+w-0.02, y+h/2-0.22, gap+0.06, 0.4, "›", size=18, color=FAINT, align=PP_ALIGN.CENTER)


# ═══════════════════════════════ 발표 자료 본문 ═══════════════════════════════
from pptx.enum.dml import MSO_LINE

def section_cover(num, title, sub):
    """섹션 표지: 큰 번호 + 제목"""
    s = prs.slides.add_slide(BLANK)
    logo(s, 0.9, 0.85, s=0.7)
    txt(s, 0.9, 2.4, 3.0, 1.6, num, size=64, bold=True, color=LINE, font="Menlo")
    txt(s, 0.9, 3.6, 11.0, 1.0, title, size=36, bold=True, color=INK)
    txt(s, 0.9, 4.6, 11.0, 0.8, sub, size=15, color=INK)
    txt(s, 0.6, 7.05, 6, 0.3, "Nodus · MABC 2026 결선 발표", size=9, color=FAINT)
    txt(s, W-3.6, 7.05, 3.0, 0.3, "MABC 2026 결선 · Let's do well", size=9, color=FAINT, align=PP_ALIGN.RIGHT)
    return s

def shot(s, name, x, y, w, caption=None):
    p = os.path.join(ASSETS, name)
    if os.path.exists(p):
        pic = s.shapes.add_picture(p, Inches(x), Inches(y), width=Inches(w)); pic.line.color.rgb = LINE; pic.line.width = Pt(0.75)
        h = w * 0.625
    else:
        rect(s, x, y, w, w*0.625, fill=PANEL, line=LINE); h = w*0.625
    if caption: txt(s, x, y + h + 0.1, w, 0.5, caption, size=11, color=INK, align=PP_ALIGN.CENTER)
    return h

# ───────────── 1. 표지
s = prs.slides.add_slide(BLANK)
logo(s, 0.9, 0.85, s=1.0)
txt(s, 1.95, 0.9, 5, 0.9, "Nodus", size=34, bold=True, color=INK)
txt(s, 0.9, 2.2, 6.4, 3.2, ["AI 대화를", "승인 통제형", "개인 위키와", "생각 지도로", "바꾸는 서비스"], size=40, bold=True, color=INK, line=1.12)
shot(s, "01-home.png", 7.0, 1.55, 5.55)
ln = s.shapes.add_connector(1, Inches(0.9), Inches(5.85), Inches(6.4), Inches(5.85)); ln.line.color.rgb = LINE
for i, (k, v) in enumerate([("팀", "Let's do well"), ("팀원", "이영민, 권윤재, 전동훈")]):
    x = 0.9 + i*2.6
    txt(s, x, 6.0, 2.6, 0.3, k, size=11, bold=True, color=MUTE)
    txt(s, x, 6.3, 3.2, 0.4, v, size=14, color=INK)
txt(s, 7.0, 6.3, 5.55, 0.4, "MABC 2026 결선 · Solar Pro 4 · ai-wiki 스킬 · MCP", size=11, color=INK, align=PP_ALIGN.RIGHT)

# ───────────── 2. 목차
s = prs.slides.add_slide(BLANK); header(s, "목차", "발표 순서")
items = [("01", "배경 및 문제 정의", "AI 대화가 쌓여도 다시 꺼내 쓰지 못하는 이유"),
         ("02", "프로젝트 소개", "서비스 한 줄 소개, 주요 기능, 기존 대안과의 차이"),
         ("03", "개발 환경 및 구조도", "아키텍처, 데이터 흐름, 기술 스택, 역할 분담"),
         ("04", "프로젝트 수행 방안", "프론트엔드 · 백엔드 · Solar 파이프라인 구현, 프로젝트 관리"),
         ("05", "시연", "기술적 문제 해결, 진행 상황, 실제 서비스 화면"),
         ("06", "결과물 및 기대효과", "성공 기준 달성 현황, 기대효과, 향후 계획")]
for i, (n, t, d) in enumerate(items):
    col = i // 3; row = i % 3
    x = 0.6 + col*6.2; y = 2.1 + row*1.55
    rect(s, x, y, 5.95, 1.35, fill=PANEL if i % 2 == 0 else WHITE, line=LINE)
    txt(s, x+0.25, y+0.28, 0.9, 0.8, n, size=26, bold=True, color=INK, font="Menlo")
    txt(s, x+1.2, y+0.22, 4.6, 0.45, t, size=17, bold=True, color=INK)
    txt(s, x+1.2, y+0.7, 4.6, 0.55, d, size=11, color=INK)

# ───────────── 3. 섹션 1 표지
section_cover("01", "배경 및 문제 정의", "AI와 나눈 대화는 매일 쌓이지만, 다시 꺼내 쓰이는 대화는 거의 없습니다")

# ───────────── 4. 배경
s = prs.slides.add_slide(BLANK); header(s, "01", "배경", "AI 대화가 일상이 된 시대, 기록은 남지만 지식은 남지 않습니다")
card(s, 0.6, 2.05, 3.9, 2.4, "현황 1", "쌓이기만 하는 대화", "AI를 자주 쓰는 사람의 대화창에는 아이디어·결정·계획·배움이 매일 쌓이지만, 세션이 끝나면 다시 찾아보기 어렵습니다.")
card(s, 4.72, 2.05, 3.9, 2.4, "현황 2", "연결되지 않는 기록", "기록이 흩어져 있으면 예전 아이디어가 지금 맥락과 이어지는 지점을 놓칩니다. 같은 질문을 다시 하고, 처음부터 다시 설명합니다.")
card(s, 8.84, 2.05, 3.89, 2.4, "현황 3", "정리는 부담", "위키로 정리하면 꺼내 쓰기 좋지만, 사람이 매번 정리하기엔 시간과 의지가 부족합니다. 정리 도구는 개발자 중심이라 진입장벽도 높습니다.")
rect(s, 0.6, 4.75, 12.13, 2.0, fill=INK)
txt(s, 0.9, 4.95, 11.5, 1.6, ["\"기록은 있는데 지식이 없다\"", "대화가 일회성 채팅으로 끝나지 않고, 승인된 위키와 관계 그래프로 누적되게 만드는 것이 Nodus의 출발점입니다."], size=16, color=WHITE, line=1.35)

# ───────────── 5. 문제 사례
s = prs.slides.add_slide(BLANK); header(s, "01", "문제 정의", "우리가 만난 두 사용자")
card(s, 0.6, 2.05, 5.95, 3.2, "사용자 1", "AI로 아이디어를 정리하며 일하는 개인", ["블로그를 쓰거나 공부하거나 기획하는 비개발자. AI와 자주 대화하지만 기록이 흩어져 있어, 예전에 했던 대화를 이어가려면 매번 찾고 다시 설명하는 데 힘이 드는 상황", ("니즈", "대화에서 자동으로 주제별 정리, 예전 생각과 지금 생각 사이 연결"), ("페인", "기록할 시간은 부족하고, 쌓아둔 대화는 다시 안 봄")], body_size=11.5)
card(s, 6.78, 2.05, 5.95, 3.2, "사용자 2", "여러 주제를 AI와 대화하며 배우는 사용자", ["학습, 취미, 의사결정, 회고 등 다양한 맥락에서 AI와 소통하는 사람. 주제가 갈라지면 어느 대화에서 무엇을 배웠는지 되짚기 어려워, 같은 질문을 다시 하는 데 힘이 드는 상황", ("니즈", "아이디어·결정·배움 단위로 위키가 생기길 원함"), ("페인", "대화가 많아져도 구조가 없어 전체 그림이 안 보임")], body_size=11.5)
table(s, 0.6, 5.5, 12.13, [
    ["해결할 문제", "내용"],
    ["문제 1", "AI와 주고받은 대화가 기록으로만 남고, 주제별 지식으로 다시 꺼내 쓰기 어렵다"],
    ["문제 2", "새 대화가 들어와도 기존 기록과 연결되지 않아, 과거 아이디어와의 관계가 드러나지 않는다"],
    ["문제 3", "개발자 중심으로 설계된 도구는 비개발자가 쓰기엔 진입장벽이 높다"],
], col_w=[2.0, 10.13], size=10.5, row_h=0.34)

# ───────────── 6. 섹션 2 표지
section_cover("02", "프로젝트 소개", "서비스 소개 · 주요 기능 · 기존 대안과의 차이")

# ───────────── 7. 서비스 소개
s = prs.slides.add_slide(BLANK); header(s, "02", "서비스 소개", "Nodus: AI 대화를 승인 통제형 개인 위키와 생각 지도로 바꾸는 웹 서비스")
txt(s, 0.6, 2.05, 6.0, 2.6, ["사용자가 AI와 주고받은 대화를 읽고, 개인화된 주제별 위키로 정리해 제공합니다.", "", "에이전트가 생성한 결과는 위키에 바로 쓰지 않고 제안 형태로만 제시하며, 사용자가 수락한 내용만 실제 개인 위키에 반영됩니다.", "", "즉, 자동 정리 및 그래프 구축과 사람의 통제(수락/기각)를 함께 제공합니다."], size=13, color=INK, line=1.35)
rect(s, 0.6, 4.8, 6.0, 2.0, fill=PANEL, line=LINE)
txt(s, 0.8, 4.92, 5.6, 1.8, ["자동과 승인의 구분", "후보 생성은 자동화 영역, 실제 반영은 사용자 승인 영역입니다. 자동 제안이 곧바로 위키에 반영되는 구조가 아니며, 실제 반영은 반드시 사용자 승인을 거칩니다."], size=11.5, color=INK, line=1.3)
shot(s, "01-home.png", 6.9, 2.05, 5.83, "생각 지도 (홈): 승인된 노드와 관계를 탐색")

# ───────────── 8. 주요 기능
s = prs.slides.add_slide(BLANK); header(s, "02", "주요 기능", "대화를 읽어 후보를 만들고, 사람이 확정하고, 지도에 남깁니다")
cw = (12.13 - 0.4) / 3
card(s, 0.6, 2.05, cw, 2.75, "기능 1", "대화 → 위키 후보 생성", "Solar Pro 4가 ai-wiki 스킬로 보관된 대화를 읽어 신규 노드 초안, 기존 위키 갱신안, 위키 간 연결 후보를 만듭니다. 같은 주제가 있으면 신규보다 갱신을 우선합니다.")
card(s, 0.6 + cw + 0.2, 2.05, cw, 2.75, "기능 2", "근거를 보고 수락 · 기각", "제안마다 이유, 원문 근거, 변경 전후 미리보기가 붙습니다. 수락한 것만 위키·버전 이력·관계로 반영되고, 결정은 새로고침 후에도 유지됩니다.")
card(s, 0.6 + 2*(cw + 0.2), 2.05, cw, 2.75, "기능 3", "생각 지도와 검색", "승인된 노드와 관계를 그래프로 탐색하고, 키워드 하나로 위키와 보관 대화를 함께 검색합니다. 노드에서 바로 대화를 이어갈 수 있습니다.")
flow(s, 5.05, [
    ("auto", "대화 보관", "\"위키에 저장해\" → MCP로 원문 전달 및 보관"),
    ("auto", "후보 생성", "Solar Pro 4가 기존 위키와 대조"),
    ("auto", "제안 제시", "이유 · 근거 · 변경 전후"),
    ("human", "사용자 확인", "수락 또는 기각"),
    ("human", "위키 반영", "수락한 것만 지도에 남음"),
], h=1.75)

# ───────────── 9. 기존 대안과의 차이
s = prs.slides.add_slide(BLANK); header(s, "02", "기존 대안과의 차이", "채팅 로그 보관도, 완전 자동 위키도 아닙니다")
table(s, 0.6, 2.05, 12.13, [
    ["", "AI 채팅 기록 · 메모리 기능", "노션 · 옵시디언 같은 메모 도구", "Nodus"],
    ["대화가 남는 형태", "세션별 로그, 검색은 되지만 구조 없음", "사람이 직접 옮겨 적어야 함", "주제별 위키 노드 + 관계 그래프로 누적"],
    ["정리 주체", "AI가 임의로 기억·요약", "전부 사람", "AI가 후보 생성, 사람이 수락"],
    ["근거 확인", "어떤 대화에서 나왔는지 불투명", "직접 남긴 것만", "원문 세그먼트 인용과 변경 전후 미리보기"],
    ["다른 AI 대화와의 연결", "제품 안에서만", "수동 링크", "MCP로 어떤 에이전트의 대화든 사용자 요청 시 수신"],
    ["진입장벽", "낮음", "높음(구조 설계 필요)", "낮음: 저장해 달라고 말하고, 제안을 고르면 끝"],
], col_w=[2.3, 3.2, 3.2, 3.43], size=10.5, row_h=0.62)
txt(s, 0.6, 6.1, 12.1, 0.7, "Nodus는 자동화를 후보 생성까지로 제한하고, 위키에 남길지는 언제나 사용자가 정합니다. 그래서 자동 정리의 편리함과 통제감을 동시에 가집니다.", size=12, color=INK, line=1.3)

# ───────────── 10. 섹션 3 표지
section_cover("03", "개발 환경 및 구조도", "아키텍처 · 데이터 흐름 · 기술 스택 · 역할 분담")

# ───────────── 11. 아키텍처
s = prs.slides.add_slide(BLANK); header(s, "03", "서비스 아키텍처", "사용자 요청 → 에이전트 → MCP → Backend → Solar Pro 4 / PostgreSQL → Frontend")
def abox(x, y, w, h, title, sub):
    rect(s, x, y, w, h, fill=WHITE, line=LINE)
    txt(s, x, y+0.18, w, 0.45, title, size=15, bold=True, color=INK, align=PP_ALIGN.CENTER)
    txt(s, x, y+0.68, w, 0.6, sub, size=10.5, color=INK, align=PP_ALIGN.CENTER, line=1.2)
def dline(x1, y1, x2, y2):
    c = s.shapes.add_connector(1, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = RGBColor(0x8A,0x93,0x9B); c.line.width = Pt(1.25); c.line.dash_style = MSO_LINE.DASH
def pill(x, y, w, text):
    r = rect(s, x, y, w, 0.3, fill=RGBColor(0xF1,0xF3,0xF4), line=LINE); r.adjustments[0] = 0.5
    txt(s, x, y+0.02, w, 0.28, text, size=9.5, color=INK, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
def actor(cx, top, h=0.55):
    hd = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx-0.08), Inches(top), Inches(0.16), Inches(0.16)); hd.fill.background(); hd.line.color.rgb = INK; hd.line.width = Pt(1.5); hd.shadow.inherit = False
    for (x1,y1,x2,y2) in [(cx,top+0.16,cx,top+0.38),(cx-0.15,top+0.24,cx+0.15,top+0.24),(cx,top+0.38,cx-0.12,top+h),(cx,top+0.38,cx+0.12,top+h)]:
        c = s.shapes.add_connector(1, Inches(x1), Inches(y1), Inches(x2), Inches(y2)); c.line.color.rgb = INK; c.line.width = Pt(1.5)
abox(0.9, 2.2, 2.4, 1.15, "사용자", "AI 대화 · 승인 결정"); actor(1.25, 2.5)
abox(4.2, 2.2, 4.4, 1.15, "AI 에이전트 (MCP 클라이언트)", "Hermes Agent · Solar Pro 4 · \"위키에 저장해\" 요청")
abox(0.9, 4.6, 3.3, 1.35, "Frontend", "React · Vite · three.js · Vercel")
abox(4.9, 4.6, 3.4, 1.35, "Backend", "Node.js · Express · TypeScript · Render")
abox(9.6, 4.6, 2.85, 1.35, "Solar Pro 4", "Upstage API · ai-wiki 스킬을 지침으로")
abox(4.9, 6.15, 3.4, 0.75, "PostgreSQL · Prisma", "")
dline(3.3, 2.775, 4.2, 2.775)
dline(2.1, 3.35, 2.1, 4.6); pill(1.65, 3.8, 0.9, "웹 UI")
dline(6.4, 3.35, 6.4, 3.95); dline(6.4, 3.95, 6.6, 3.95); dline(6.6, 3.95, 6.6, 4.6); pill(6.75, 3.8, 3.2, "MCP · submit_conversation · Bearer 토큰")
dline(4.2, 5.27, 4.9, 5.27); pill(4.1, 5.05, 0.9, "REST /api")
dline(8.3, 5.27, 9.6, 5.27); pill(8.45, 5.05, 1.0, "후보 · 관계")
dline(6.6, 5.95, 6.6, 6.15)

# ───────────── 12. 데이터 흐름
s = prs.slides.add_slide(BLANK); header(s, "03", "데이터 수신 · 저장 · 반영 흐름", "보관 → 후보 생성 → 제안 → 사용자 확인 → 반영 파이프라인 · 승인을 받지 않은 내용은 위키에 쓰이지 않습니다")
flow(s, 2.05, [
    ("auto", "전송 시작", "사용자의 명시적 저장 요청 → 에이전트가 MCP 도구 submit_conversation 호출"),
    ("auto", "보관", "원문 구간 + 맥락을 원본 보관 영역에 저장. 정리본과 분리"),
    ("auto", "후보 생성", "Solar Pro 4가 ai-wiki 스킬로 기존 위키와 대조해 신규·갱신·연결 제안 생성"),
    ("human", "사용자 확인", "변경 전후와 원문 근거를 보고 수락 / 기각"),
    ("human", "반영", "수락한 것만 위키·버전 이력·관계·생각 지도에 반영"),
], h=1.75)
txt(s, 0.6, 4.05, 6, 0.35, "전송 규칙", size=14, bold=True, color=INK)
bullets(s, 0.6, 4.42, 6.0, 2.5, [
    "사용자가 \"이 내용을 위키에 저장해줘\"라고 요청할 때만 전송합니다. 자동 수집은 하지 않습니다",
    "구간을 지정했으면 그 구간만, 지정하지 않았으면 현재 주제와 관련된 범위만 묶어 보냅니다",
    "에이전트에게 실제로 보이는 대화만 보내고, 없는 대화를 만들어내지 않습니다",
], size=11, gap=3)
txt(s, 6.9, 4.05, 6, 0.35, "저장 구조", size=14, bold=True, color=INK)
bullets(s, 6.9, 4.42, 5.85, 2.5, [
    "원본 보관 영역과 위키 정리본 영역을 분리합니다",
    "원문을 세그먼트로 나눠 제안의 근거가 어느 문장에서 왔는지 추적합니다",
    "수락된 갱신은 기존 내용을 보존하며 새 버전으로 누적하고, 수락된 연결은 관계로 저장합니다",
], size=11, gap=3)

# ───────────── 13. 기술 스택
s = prs.slides.add_slide(BLANK); header(s, "03", "기술 스택", "규정에 따라 LLM은 Solar Pro 4만 사용합니다")
cols = [("Frontend", ["React 18 · TypeScript", "Vite 5", "three.js (별자리 그래프)", "Vercel 배포"]),
        ("Backend", ["Node.js · Express", "TypeScript", "Prisma ORM", "Render 배포"]),
        ("Data", ["PostgreSQL", "Record · Segment · Node · NodeVersion", "Proposal · Evidence · Relationship", "McpCredential"]),
        ("AI · 연동", ["Solar Pro 4 (Upstage API)", "ai-wiki 스킬 (SKILL.md 지침)", "MCP Streamable HTTP + Bearer 토큰", "Hermes Agent (MCP 클라이언트)"])]
cw = (12.13 - 0.6) / 4
for i, (t, items) in enumerate(cols):
    x = 0.6 + i*(cw+0.2)
    card(s, x, 2.05, cw, 3.4, None, t, items, body_size=11.5)
rect(s, 0.6, 5.7, 12.13, 1.1, fill=PANEL, line=LINE)
txt(s, 0.8, 5.82, 11.8, 0.9, "개발 도구도 규정을 따랐습니다. 코드는 Solar Pro 4를 연결한 Hermes Agent로 작성하고, 팀원은 검토·통합·배포를 맡았습니다.", size=12, color=INK, line=1.3)

# ───────────── 14. 역할 분담
s = prs.slides.add_slide(BLANK); header(s, "03", "역할 분담", "팀 Let's do well")
cw = (12.13 - 0.4) / 3
card(s, 0.6, 2.05, cw, 3.6, "이영민", "Backend · MCP 연동", ["MCP 서버(/mcp)와 사용자별 토큰 발급", "Solar 후보 생성 파이프라인(candidateGenerator)", "제안 수락·기각·삭제와 위키 반영 로직", "Prisma 스키마·마이그레이션, Render 배포"], body_size=11.5)
card(s, 0.6 + cw + 0.2, 2.05, cw, 3.6, "권윤재", "생각 지도 · 그래프", ["three.js 별자리 그래프 시각화", "그래프 API(/api/graph)와 관계 표시", "세션 그래프 분석 파이프라인", "노드 선택·태그 강조 상호작용"], body_size=11.5)
card(s, 0.6 + 2*(cw + 0.2), 2.05, cw, 3.6, "전동훈", "Frontend 통합 · 기획", ["UI 셸 통합(사이드바·상단바·페이지 체계)", "대화방·검색·제안 상세 화면과 API 연결", "자동 로그인·배포 설정(Vercel 프록시)", "PRD·포스터·발표 자료"], body_size=11.5)
txt(s, 0.6, 5.9, 12.1, 0.8, "세 명 모두 Hermes Agent(Solar Pro 4)로 코드를 작성하고, GitHub main 브랜치에서 서로의 변경을 병합하며 진행했습니다.", size=12, color=INK, line=1.3)

# ───────────── 15. 섹션 4 표지
section_cover("04", "프로젝트 수행 방안", "Frontend · Backend · Solar 파이프라인 구현, 프로젝트 관리")

# ───────────── 16. 구현: Backend · Solar 파이프라인
s = prs.slides.add_slide(BLANK); header(s, "04", "구현 1: Backend · Solar 파이프라인", "대화 원문이 제안이 되어 위키에 반영되기까지")
card(s, 0.6, 2.05, 3.9, 4.7, None, "수신과 보관", ["MCP submit_conversation으로 messages 또는 conversation_text 수신", "사용자 토큰(Bearer)으로 계정 격리", "Record로 보관하고 줄 단위 ConversationSegment 생성", "같은 원문은 contentHash로 중복 방지"], body_size=11.5)
card(s, 4.72, 2.05, 3.9, 4.7, None, "후보 생성", ["Solar Pro 4에 ai-wiki 스킬 규칙과 기존 위키 목록을 함께 전달", "newNodes(신규)·갱신·연결 제안을 구조화 JSON으로 수신", "근거 세그먼트가 없는 제안, 연결 대상이 유효하지 않은 제안은 제외", "관심사 후보는 InterestTracking에 누적"], body_size=11.5)
card(s, 8.84, 2.05, 3.89, 4.7, None, "승인과 반영", ["수락 시 트랜잭션으로 노드 생성 또는 버전 갱신, 연결은 NodeRelationship 저장", "기각은 상태만 기록, 위키 미반영", "이미 결정된 제안은 재결정 불가(409)", "RecordToNode로 원문→노드 매핑 추적"], body_size=11.5)

# ───────────── 17. 구현: Frontend
s = prs.slides.add_slide(BLANK); header(s, "04", "구현 2: Frontend", "처음 온 사람도 흐름을 따라갈 수 있는 화면")
card(s, 0.6, 2.05, 5.95, 2.25, None, "화면 체계", ["사이드바 5개 항목: 생각 지도 · 대화 · 내 위키 · 유입 기록 · 제안 목록 · MCP 연결", "상단바에 경로 표시와 통합 검색", "없는 경로는 홈으로, 첫 방문은 데모 계정 자동 로그인"], body_size=11.5)
card(s, 6.78, 2.05, 5.95, 2.25, None, "생각 지도", ["three.js 별자리 그래프로 승인된 노드와 관계 표시", "노드 선택 시 요약·정리 본문, 전체 보기, 대화로 이어가기", "그래프 API에서 노드와 edges를 받아 렌더링"], body_size=11.5)
card(s, 0.6, 4.5, 5.95, 2.25, None, "제안 · 위키", ["제안 목록: 유형·상태 배지, 삭제", "제안 상세: 변경 전/후 비교, 원문 근거 인용, 수락·기각", "내 위키 · 노드 상세 · 유입 기록 원문 3줄 미리보기"], body_size=11.5)
card(s, 6.78, 4.5, 5.95, 2.25, None, "대화 · 검색", ["서비스 안에서 Solar와 대화, 과거 대화·위키 맥락 주입", "검색: 위키 노드와 과거 대화를 한 번에, 연결된 위키 표시", "MCP 연결 페이지에서 토큰 발급·폐기"], body_size=11.5)

# ───────────── 18. 구현: Solar 프롬프트 설계
s = prs.slides.add_slide(BLANK); header(s, "04", "구현 3: Solar Pro 4 프롬프트 설계", "ai-wiki 스킬 규칙을 지침으로, 구조화 출력으로 후보를 받습니다")
bullets(s, 0.6, 2.05, 6.0, 4.8, [
    ("스킬 지침 주입:", "ai-wiki-SKILL.md 원문을 시스템 프롬프트에 넣고 해시로 버전 추적"),
    ("기존 위키 대조:", "사용자 노드 목록을 함께 전달해 같은 주제면 신규보다 갱신을 우선"),
    ("출력 계약:", "newNodes[], proposals[](갱신·연결만), interestCandidates[], sensitiveInfo 를 JSON 하나로"),
    ("근거 강제:", "제안의 evidenceSegments에 실제 세그먼트 id만 허용, 없으면 제외"),
    ("관계 유도:", "AutoSchema 방식을 참고해 노드의 개념적 역할과 관계 유형을 추론하되, 공통 단어만으로는 연결하지 않음"),
    ("민감 정보:", "비밀번호·토큰·연락처는 본문에 쓰지 않고 플래그로만 남김"),
], size=12, gap=7)
rect(s, 6.9, 2.05, 5.83, 4.8, fill=RGBColor(0xF4,0xF6,0xF7), line=LINE)
txt(s, 7.05, 2.15, 5.55, 4.6, ['{', '  "newNodes": [', '    { "title": "핸드드립 커피 입문 가이드",', '      "summary": "...", "content": "...",', '      "topics": ["커피"], "tags": [...], "categories": [...] }', '  ],', '  "proposals": [', '    { "type": "연결",', '      "sourceNodeId": "...", "targetNodeId": "...",', '      "action": "두 위키를 연결", "reason": "...",', '      "evidenceSegments": ["seg-id"] }', '  ],', '  "interestCandidates": [{ "interest": "...", "snippet": "..." }],', '  "sensitiveInfo": { "hasSensitiveInfo": false }', '}'], size=9.5, color=INK, font="Menlo", line=1.2)

# ───────────── 19. 프로젝트 관리
s = prs.slides.add_slide(BLANK); header(s, "04", "프로젝트 관리", "문서와 계약을 먼저 정하고, 브랜치를 나눠 개발한 뒤 main으로 모았습니다")
cw = (12.13 - 0.4) / 3
card(s, 0.6, 2.05, cw, 2.2, None, "기획 · 문서", ["PRD 0.1 → 0.2 (MVP 범위 확정)", "ai-wiki 스킬 규칙 문서", "MCP 연동 문서(INTEGRATION.md)"], body_size=11.5)
card(s, 0.6 + cw + 0.2, 2.05, cw, 2.2, None, "계약 · 설계", ["submit_conversation 입력 계약", "Prisma 스키마 12개 모델", "REST API · 그래프 API 명세"], body_size=11.5)
card(s, 0.6 + 2*(cw + 0.2), 2.05, cw, 2.2, None, "개발 · 배포", ["기능 브랜치 → main 병합", "GitHub Actions CI(빌드·스키마 검증)", "Vercel(프론트) · Render(백엔드) 자동 배포"], body_size=11.5)
table(s, 0.6, 4.55, 12.13, [
    ["단계", "기간", "산출물"],
    ["리서치 / 설계", "예선 ~ 09-11", "사용자 유형, 위키 단위, 제안·관계 방식, 데이터 모델 초안, PRD 0.1"],
    ["MVP 개발", "09-12 ~ 09-16", "MCP 수신·보관, 후보 생성, 대조 제안, 관계 제시, 조회·검색, 수락·기각"],
    ["내부 테스트 · 제출", "09-16", "실제 대화로 품질 확인, 배포본 확정"],
], col_w=[2.6, 2.4, 7.13], size=11, row_h=0.5)

# ───────────── 20. 섹션 5 표지
section_cover("05", "시연", "기술적 문제 해결 · 진행 상황 · 실제 서비스 화면")

# ───────────── 21. 기술적 문제 해결
s = prs.slides.add_slide(BLANK); header(s, "05", "기술적 문제 해결", "개발 중 실제로 부딪힌 문제와 해결")
cw = (12.13 - 0.4) / 3
card(s, 0.6, 2.05, cw, 4.6, "문제 1", "수락할 수 없는 제안", ["Solar가 같은 대화에서 신규 노드 제안을 두 경로로 만들어, 한쪽은 초안 payload가 없어 수락 시 오류", ("해결", "신규 노드는 newNodes 경로로만 만들고 proposals의 '추가' 유형은 제외. 프롬프트에도 갱신·연결만 허용하도록 명시")], body_size=11)
card(s, 0.6 + cw + 0.2, 2.05, cw, 4.6, "문제 2", "근거 없는 제안", ["대화방에서 바로 저장한 원문은 세그먼트가 없어 후보 생성기가 근거를 특정하지 못해 제안이 0건", ("해결", "모든 유입 경로에서 원문을 줄 단위 세그먼트로 분할해 저장하고, 근거 id 검증을 통과한 제안만 생성")], body_size=11)
card(s, 0.6 + 2*(cw + 0.2), 2.05, cw, 4.6, "문제 3", "브라우저별 세션 유지", ["프론트(Vercel)와 백엔드(Render) 도메인이 달라 Safari에서 세션 쿠키가 저장되지 않아 로그인 필요 상태 반복", ("해결", "Vercel 재작성 규칙으로 /api를 백엔드로 프록시해 같은 사이트 쿠키로 전환, SPA 새로고침 404도 함께 해결")], body_size=11)

# ───────────── 22. 진행 상황
s = prs.slides.add_slide(BLANK); header(s, "05", "진행 상황", "MVP 성공 기준 기준")
table(s, 0.6, 2.05, 12.13, [
    ["MVP 성공 기준", "상태"],
    ["MCP로 제출한 대화가 사용자 계정의 유입 기록에 저장된다", "완료"],
    ["제출된 대화에서 최소 한 개 이상의 신규·갱신·연결 제안을 생성할 수 있다", "완료"],
    ["신규 제안을 수락하면 내 위키에 노드가 생성된다", "완료"],
    ["같은 주제의 후속 대화가 기존 위키 갱신 제안으로 이어진다", "구현됨 · 시연 데이터로 확인 예정"],
    ["연결 제안을 수락하면 생각 지도에 두 위키의 관계선이 표시된다", "구현됨 · 시연 데이터로 확인 예정"],
    ["기각한 제안은 위키에 반영되지 않는다", "완료"],
    ["새로고침 후에도 위키와 결정 상태가 유지된다", "완료"],
], col_w=[8.6, 3.53], size=11.5, row_h=0.5)
txt(s, 0.6, 6.3, 12.1, 0.6, "추가로 구현한 것: 서비스 내 Solar 대화(과거 맥락 주입), 위키·대화 통합 검색, 제안 삭제, MCP 토큰 관리, 데모 자동 로그인", size=11.5, color=INK)

# ───────────── 23~25. 서비스 화면
def screen_slide(title, sub, left, right):
    s = prs.slides.add_slide(BLANK); header(s, "05", title, sub)
    for (name, cap, desc), x in ((left, 0.6), (right, 6.78)):
        h = shot(s, name, x, 2.05, 5.95)
        txt(s, x, 2.05 + h + 0.15, 5.95, 0.4, cap, size=14, bold=True, color=INK)
        txt(s, x, 2.05 + h + 0.55, 5.95, 1.0, desc, size=11, color=INK, line=1.3)
screen_slide("서비스 화면 1: 대화가 들어오는 곳", "유입 기록과 대화방",
    ("06-records.png", "유입 기록", "MCP로 보낸 대화 원문이 계정별로 보관됩니다. 원본은 정리본과 분리되어 그대로 남습니다."),
    ("05-chat.png", "대화", "서비스 안에서 Solar와 대화합니다. 예전 대화나 위키를 묻는 질문에는 실제 기록을 찾아 답합니다."))
screen_slide("서비스 화면 2: 제안을 고르는 곳", "제안 목록과 제안 상세",
    ("02-proposals.png", "제안 목록", "신규·갱신·연결 제안이 유형과 상태 배지와 함께 쌓입니다. 결정한 제안은 다시 바꿀 수 없습니다."),
    ("03-proposal-detail.png", "제안 상세", "변경 전/후 비교와 원문 근거 인용을 확인한 뒤 수락 또는 기각합니다."))
screen_slide("서비스 화면 3: 지식이 남는 곳", "생각 지도와 검색",
    ("01-home.png", "생각 지도", "수락한 노드와 관계만 그래프에 남습니다. 노드를 누르면 정리된 내용을 읽고 대화를 이어갈 수 있습니다."),
    ("04-search.png", "검색", "키워드 하나로 위키 노드와 보관 대화를 함께 찾고, 대화 결과에는 연결된 위키가 근거로 붙습니다."))

# ───────────── 26. 섹션 6 표지
section_cover("06", "결과물 및 기대효과", "기대효과 · 향후 계획")

# ───────────── 27. 기대효과
s = prs.slides.add_slide(BLANK); header(s, "06", "결과물 및 기대효과", "")
cw = (12.13 - 0.4) / 3
card(s, 0.6, 2.05, cw, 2.6, "결과물", "배포된 웹 서비스", ["Vercel + Render 공개 URL", "MCP 엔드포인트와 사용자별 토큰", "PRD v0.2, 포스터, 발표 자료"], body_size=11.5)
card(s, 0.6 + cw + 0.2, 2.05, cw, 2.6, "사용자에게", "정리 부담 없이 쌓이는 지식", ["따로 정리하지 않아도 대화가 위키로 남음", "새 대화가 기존 위키의 갱신·연결 제안으로 이어짐", "근거를 확인하고 결정하는 통제감"], body_size=11.5)
card(s, 0.6 + 2*(cw + 0.2), 2.05, cw, 2.6, "설계 관점에서", "승인 통제형 AI 정리의 기준", ["후보 생성은 자동, 반영은 사람", "모든 제안에 원문 근거와 변경 전후", "원본과 정리본의 분리"], body_size=11.5)
rect(s, 0.6, 4.9, 12.13, 1.9, fill=INK)
txt(s, 0.9, 5.1, 11.5, 1.5, ["\"AI가 내 생각을 대신 정리해 두는 방향이 아니라,", "AI가 후보를 내고 내가 확정해 쌓아 가는 방향\""], size=18, bold=True, color=WHITE, line=1.35)

# ───────────── 28. 향후 계획
s = prs.slides.add_slide(BLANK); header(s, "06", "향후 계획", "MVP에서 의도적으로 제외한 것들을 순서대로")
table(s, 0.6, 2.05, 12.13, [
    ["단계", "내용", "지금 갖춰진 재료"],
    ["1", "개인화 기억: 승인·기각 이력과 관심사 추적을 후보 생성과 검색 랭킹에 반영", "InterestTracking에 관심사가 이미 누적, 결정 이력 보존"],
    ["2", "그래프 경로 기반 탐색: 관계를 따라 검색 결과를 계층적으로 제시", "NodeRelationship과 그래프 API"],
    ["3", "제안 직접 편집: 수락 전에 사용자가 초안을 고쳐 반영", "변경 전/후 스냅샷 구조"],
    ["4", "팀·커뮤니티 공유: 여러 사람이 주고받은 맥락을 함께 보는 위키", "사용자별 격리 구조를 팀 단위로 확장"],
], col_w=[1.0, 6.9, 4.23], size=11.5, row_h=0.62)

# ───────────── 29. 마무리
s = prs.slides.add_slide(BLANK)
logo(s, 0.9, 0.85, s=0.7)
txt(s, 0.9, 2.6, 11.5, 1.2, "지금까지 Let's do well 팀의 Nodus였습니다.", size=34, bold=True, color=INK)
txt(s, 0.9, 3.9, 11.5, 0.8, "경청해 주셔서 감사합니다.", size=20, color=INK)
txt(s, 0.9, 5.2, 11.5, 0.5, "AI는 제안하고, 위키는 내가 확정한다.", size=15, color=INK)
txt(s, 0.6, 7.05, 6, 0.3, "Nodus · MABC 2026 결선 발표", size=9, color=FAINT)
txt(s, W-3.6, 7.05, 3.0, 0.3, "MABC 2026 결선 · Let's do well", size=9, color=FAINT, align=PP_ALIGN.RIGHT)

prs.save(OUT)
print("saved", OUT, "slides:", len(prs.slides))
