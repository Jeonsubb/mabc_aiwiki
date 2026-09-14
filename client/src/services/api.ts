import type {
  NodesResponse,
  NodeResponse,
  ProposalsResponse,
  ProposalResponse,
  DecideRequest,
  RecordsResponse,
} from '@shared/api';

const BASE = import.meta.env.VITE_BACKEND_URL || '/api';

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
};
