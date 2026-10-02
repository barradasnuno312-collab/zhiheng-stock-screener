import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { isAxiosError } from 'axios';
import type {
  AccessSession, CatalogResponse, CompareRequest, JobStatus, LoadVersionResponse,
  Monitor, MonitorEvent, ParseRequest, RunComparison, SavedVersion, SaveStrategyRequest,
  ScreenRequest, ScreenRun, StockCompareResponse,
} from '../../../shared/api.interface';

async function request<T>(url: string, method: 'GET' | 'POST' | 'PATCH', data?: unknown): Promise<T> {
  const response = await axiosForBackend<T>({ url, method, data, meta: { autoJumpToLogin: false } });
  return response.data;
}
export const session = (): Promise<AccessSession> => request('/api/access/session', 'GET');
export const login = (code: string): Promise<AccessSession> => request('/api/access/verify', 'POST', { code });
export const logout = (): Promise<AccessSession> => request('/api/access/logout', 'POST');
export const catalog = (): Promise<CatalogResponse> => request('/api/research/catalog', 'GET');
export const parse = (data: ParseRequest): Promise<JobStatus> => request('/api/research/intent', 'POST', data);
export const job = (id: string): Promise<JobStatus> => request(`/api/research/jobs/${id}`, 'GET');
export const execute = (data: ScreenRequest): Promise<ScreenRun> => request('/api/research/runs', 'POST', data);
export const run = (id: string): Promise<ScreenRun> => request(`/api/research/runs/${id}`, 'GET');
export const compare = (data: CompareRequest): Promise<RunComparison> => request('/api/research/compare', 'POST', data);
export const stocks = (runId: string, codes: string[]): Promise<StockCompareResponse> =>
  request(`/api/research/runs/${runId}/stocks`, 'POST', { codes });
export const versions = (): Promise<SavedVersion[]> => request('/api/research/versions', 'GET');
export const save = (data: SaveStrategyRequest): Promise<SavedVersion> => request('/api/research/versions', 'POST', data);
export const load = (id: string): Promise<LoadVersionResponse> => request(`/api/research/versions/${id}`, 'GET');
export const monitors = (): Promise<Monitor[]> => request('/api/research/monitors', 'GET');
export const createMonitor = (versionId: string): Promise<Monitor> =>
  request('/api/research/monitors', 'POST', { versionId });
export const toggle = (id: string, enabled: boolean): Promise<Monitor> =>
  request(`/api/research/monitors/${id}`, 'PATCH', { enabled });
export const check = (id: string): Promise<MonitorEvent | null> => request(`/api/research/monitors/${id}/check`, 'POST');

export function errorMessage(error: unknown): string {
  if (isAxiosError<{ error?: { message?: string } }>(error)) {
    return error.response?.data?.error?.message ?? '连接未完成，请稍后重试';
  }
  return error instanceof Error ? error.message : '操作未完成，请重试';
}
