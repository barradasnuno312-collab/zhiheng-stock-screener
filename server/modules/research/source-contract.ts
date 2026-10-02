import { z } from 'zod';
import type { SourceMeta } from './metrics';

export interface SourceResponse {
  items: Record<string, unknown>[];
  meta: SourceMeta;
}
export class FuyaoError extends Error {
  readonly code: number;
  readonly retryable: boolean;
  readonly requestId: string | null;
  constructor(code: number, retryable: boolean, requestId: string | null) {
    super(`扶摇数据请求失败（${code}）${requestId ? `，请求ID ${requestId}` : ''}`);
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}
const envelopeSchema = z.object({
  code: z.number(), request_id: z.string().max(200).optional(),
  data: z.unknown().optional(),
});
const dataSchema = z.object({
  timestamp: z.number().nullable().optional(),
  item: z.array(z.record(z.string(), z.unknown())),
});
export function decodeResponse(raw: unknown, endpoint: string, fetchedAt: string): SourceResponse {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) throw new FuyaoError(5003, false, null);
  const { code, request_id: requestId } = envelope.data;
  if (code !== 0) throw new FuyaoError(code, [4001, 5002, 5003].includes(code), requestId ?? null);
  const data = dataSchema.safeParse(envelope.data.data);
  if (!data.success) throw new FuyaoError(5003, false, requestId ?? null);
  return { items: data.data.item,
    meta: { endpoint, requestId: requestId ?? null, fetchedAt, timestamp: data.data.timestamp ?? null } };
}
