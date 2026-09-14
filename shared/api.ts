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

export interface Chat {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
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
  pendingUserMessageId?: string;
}

export interface ChatRetryResponse {
  status: 'success' | 'error' | 'already_answered';
  assistantMessage?: ChatMessage;
  lastMessage?: ChatMessage;
  error?: string;
  pendingUserMessageId?: string;
}

export interface CreateChatResponse {
  chat: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
}

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
  type: '추가' | '갱신' | '분리' | '병합' | '연결' | '보강' | '수정';
  targetNodeId?: string;
  sourceNodeId?: string;
  action: string;
  reason: string;
  evidence: string;
  before?: { summary: string; content: string };
  after?: { summary: string; content: string };
  status: '제안됨' | '승인됨' | '기각됨' | '반영됨';
  decisionAt?: string;
  decisionAction?: string;
  reflected?: boolean;
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
    session_id: string;
    stored_at: string;
    conversation_text: string;
    context: Record<string, unknown>;
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
