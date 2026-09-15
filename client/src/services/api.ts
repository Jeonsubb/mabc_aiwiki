import type {
  NodesResponse,
  NodeResponse,
  ProposalsResponse,
  ProposalResponse,
  DecideRequest,
  RecordsResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  LogoutResponse,
  ChatsResponse,
  ChatDetailResponse,
  ChatMessageResponse,
  ChatRetryResponse,
  McpCredentialsListResponse,
  McpCredentialCreateResponse,
  McpCredentialRevokeResponse,
} from '@shared/api';

export interface WikiSearchResponse {
  results: Array<{
    type: 'wiki_node';
    nodeId: string;
    title: string;
    summary: string;
    topics: string[];
    updatedAt: string;
  }>;
  total: number;
}

export interface ChatSearchResponse {
  results: Array<{
    type: 'chat_message';
    messageId: string;
    chatId: string;
    role: string;
    content: string;
    createdAt: string;
    linkedNode: { nodeId: string; nodeTitle: string } | null;
  }>;
  total: number;
}

const BASE = import.meta.env.VITE_BACKEND_URL || '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '요청 실패' }));
    throw new Error(err.error || '요청 실패');
  }
  return res.json();
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '요청 실패' }));
    throw new Error(err.error || '요청 실패');
  }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '요청 실패' }));
    throw new Error(err.error || '요청 실패');
  }
  return res.json();
}

export const api = {
  getNodes: () => get<NodesResponse>('/nodes'),
  getNode: (id: string) => get<NodeResponse>(`/nodes/${id}`),
  getProposals: () => get<ProposalsResponse>('/proposals'),
  getProposal: (id: string) => get<ProposalResponse>(`/proposals/${id}`),
  getRecords: () => get<RecordsResponse>('/records'),
  decideProposal: (id: string, body: DecideRequest) =>
    post<ProposalResponse>(`/proposals/${id}/decide`, body),
  login: (body: LoginRequest) => post<LoginResponse>('/auth/login', body),
  me: () => get<MeResponse>('/auth/me'),
  logout: () => post<LogoutResponse>('/auth/logout', {}),
  getChats: () => get<ChatsResponse>('/chats'),
  createChat: (body?: { title?: string; firstMessage?: string }) =>
    post<{ chat: { id: string; title: string; createdAt: string; updatedAt: string } }>('/chats', body || {}),
  getChatDetail: (id: string) => get<ChatDetailResponse>(`/chats/${id}`),
  sendMessage: (id: string, content: string) =>
    post<ChatMessageResponse>(`/chats/${id}/messages`, { content }),
  retryMessage: (id: string, messageId: string) =>
    post<ChatRetryResponse>(`/chats/${id}/retry`, { messageId }),
  listCredentials: () => get<McpCredentialsListResponse>('/credentials'),
  createCredential: (name: string) =>
    post<McpCredentialCreateResponse>('/credentials', { name }),
  revokeCredential: (id: string) =>
    del<McpCredentialRevokeResponse>(`/credentials/${id}`),
  searchWikiNodes: (q: string) => get<WikiSearchResponse>(`/search/wiki-nodes?q=${encodeURIComponent(q)}&limit=20`),
  searchChatMessages: (q: string) => get<ChatSearchResponse>(`/search/chat-messages?q=${encodeURIComponent(q)}&limit=20`),
};
