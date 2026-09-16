export interface WikiNode {
  id: string;
  title: string;
  summary: string;
  content: string;
  topics: string[];
  updatedAt: string;
}

export interface ProposalSnapshot {
  summary?: string;
  content?: string;
  [key: string]: unknown;
}

export interface ProposalEvidence {
  id: string;
  segmentId: string;
  quote: string;
  originalStart: number;
  originalEnd: number;
}
export interface ProposalNodeSummary {
  id: string;
  title: string;
  summary: string;
}

export interface Proposal {
  id: string;
  type: '추가' | '갱신' | '분리' | '병합' | '연결' | '보강' | '수정';
  targetNodeId?: string;
  sourceNodeId?: string;
  sourceNode?: ProposalNodeSummary | null;
  targetNode?: ProposalNodeSummary | null;
  action: string;
  reason: string;
  evidence?: ProposalEvidence[] | null;
  draftPayload?: ProposalSnapshot | null;
  changePayload?: ProposalSnapshot | null;
  before?: ProposalSnapshot | null;
  after?: ProposalSnapshot | null;
  status: '제안됨' | '승인됨' | '기각됨' | '반영됨';
  decisionAt?: string;
  decisionAction?: string;
  reflected?: boolean;
  /** 신규 노드 제안에서 선택적으로 붙는, 연결할 기존 노드 정보 */
  connectionTargetNodeId?: string;
  connectionTargetNode?: ProposalNodeSummary | null;
  connectionReason?: string;
  connectionRelationType?: string;
  connectionSchemaReason?: string;
  connectionTags?: string[];
}

export interface NodesResponse {
  nodes: WikiNode[];
}

export interface NodeSourceRecord {
  id: string;
  conversationId: string;
  source: string;
  rawText: string;
  createdAt: string;
}

export interface NodeResponse {
  node: WikiNode;
  records: NodeSourceRecord[];
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
    session_id: string;
    stored_at: string;
    conversation_text: string;
    context: Record<string, unknown>;
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

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
  };
}

export interface RegisterRequest {
  email: string;
  name?: string;
  password: string;
}

export interface RegisterResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    createdAt: string;
  };
}

export interface LogoutResponse {
  ok: boolean;
}

export interface DecideRequest {
  action: '수락' | '기각';
}

export interface McpCredentialListItem {
  id: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface McpCredentialsListResponse {
  credentials: McpCredentialListItem[];
}

export interface McpCredentialCreateResponse {
  credential: McpCredentialListItem;
  token: string;
}

export interface McpCredentialRevokeResponse {
  ok: boolean;
  revokedAt: string;
}

export interface McpCredentialDeleteResponse {
  ok: boolean;
}

export interface DeleteProposalResponse {
  ok: boolean;
}

export type RetryStatus = 'processing' | 'done' | 'failed';

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  retryStatus: RetryStatus | null;
  referencedMessageId?: string | null;
}

export interface ChatListChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: {
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
  } | null;
}

export interface ChatsResponse {
  chats: ChatListChat[];
}

export interface ChatDetailResponse {
  chat: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: ChatMessage[];
  };
}

export interface ChatMessageResponse {
  status: 'success' | 'error';
  userMessage?: ChatMessage;
  assistantMessage?: ChatMessage;
  error?: string;
  pendingUserMessageId?: string | null;
}

export interface ChatRetryRequest {
  messageId: string;
}

export interface ChatRetryResponse {
  status: 'success' | 'error' | 'already_answered';
  userMessage?: ChatMessage;
  assistantMessage?: ChatMessage;
  error?: string;
  pendingUserMessageId?: string | null;
}

export interface CreateChatResponse {
  chat: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
}

export interface AuthSession {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

let _authSession: AuthSession | null = null;

export function getAuthSession(): AuthSession | null {
  return _authSession;
}

export function setAuthSession(session: AuthSession | null): void {
  _authSession = session;
}

export interface GraphNode {
  id: string;
  title: string;
  summary: string;
  topics: string[];
  tags: string[];
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationType: string;
  description: string | null;
  evidence: string;
  tags: string[];
  status: 'confirmed';
  createdAt: string;
}

export interface SuggestedGraphEdge {
  proposalId: string;
  source: string;
  target: string;
  description: string;
  reason: string;
  evidence: string;
  tags: string[];
  status: 'suggested';
  createdAt: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  suggestedEdges: SuggestedGraphEdge[];
}