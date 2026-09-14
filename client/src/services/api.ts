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
} from '@shared/api';

const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
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
};
