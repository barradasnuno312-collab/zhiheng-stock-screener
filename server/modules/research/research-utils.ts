import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ZodType } from 'zod';

export const SHARED_OWNER = 'market-data';

/** Deterministic UUID makes retrying an interrupted job safe. */
export function stableId(namespace: string, key: string): string {
  const hex: string = createHash('sha256').update(`${namespace}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function validate<T>(schema: ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join('；'));
  }
  return parsed.data;
}
export function safeMessage(error: unknown): string {
  // External exceptions can contain provider configuration; never expose arbitrary error text.
  return error instanceof BadRequestException ? error.message : '任务未完成，请稍后重试或联系维护者';
}
