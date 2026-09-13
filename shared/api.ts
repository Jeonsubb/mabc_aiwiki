export interface WikiNode {
  id: string;
  title: string;
  summary: string;
  content: string;
  topics: string[];
  updatedAt: string;
}

export interface Proposal {
  id: string;
  type: '추가' | '변경·분리' | '연결';
  targetNodeId?: string;
  sourceNodeId?: string;
  action: string;
  reason: string;
  evidence: string;
  before: { summary: string; content: string };
  after: { summary: string; content: string };
  status: '제안됨' | '승인됨' | '기각됨' | '반영됨';
  decisionAt?: string;
  decisionAction?: string;
}

export interface DecideRequest {
  action: '수락' | '기각';
}

export interface NodesResponse {
  nodes: WikiNode[];
}

export interface NodeResponse {
  node: WikiNode;
}

export interface ProposalsResponse {
  proposals: Proposal[];
}

export interface ProposalResponse {
  proposal: Proposal;
}

export interface RecordsResponse {
  records: Array<{
    id: string;
    conversationId: string;
    source: string;
    receivedAt: string;
    status: string;
  }>;
}

export interface RecordCreateResponse {
  record: {
    id: string;
    conversationId: string;
    receivedAt: string;
    status: string;
  };
}
