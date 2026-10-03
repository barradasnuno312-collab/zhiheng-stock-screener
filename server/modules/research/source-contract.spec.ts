import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeResponse, FuyaoError } from './source-contract';

test('HTTP 200 business permission failure is an error and never retried', () => {
  assert.throws(() => decodeResponse({ code: 2001, request_id: 'r' }, '/source', 't'),
    (error: unknown) => error instanceof FuyaoError && error.code === 2001 && !error.retryable);
});
test('business throttling and upstream timeout permit bounded retry', () => {
  for (const code of [4001, 5002, 5003]) {
    assert.throws(() => decodeResponse({ code, request_id: 'r' }, '/source', 't'),
      (error: unknown) => error instanceof FuyaoError && error.retryable);
  }
});
test('HTML, invalid success envelopes and missing item arrays never masquerade as empty results', () => {
  for (const raw of ['<html>login</html>', null, {}, { code: 0 }, { code: 0, data: {} }]) {
    assert.throws(() => decodeResponse(raw, '/source', 't'));
  }
});
test('valid empty data stays explicitly empty and missing timestamp stays null', () => {
  const result = decodeResponse({ code: 0, request_id: 'r', data: { item: [] } }, '/source', 't');
  assert.deepEqual(result.items, []);
  assert.equal(result.meta.timestamp, null);
  assert.equal(result.meta.requestId, 'r');
});
test('public reviewer path uses anonymous cookie sessions without a password gate', () => {
  const access = readFileSync(new URL('./access.service.ts', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('./research.controller.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../../client/src/pages/research/ResearchPage.tsx', import.meta.url), 'utf8');
  assert.match(access, /async start\(req: Request, res: Response\)/);
  assert.doesNotMatch(access, /ZH_ACCESS_CODE|访问码不正确/);
  assert.doesNotMatch(controller, /@Post\('verify'\)/);
  assert.doesNotMatch(page, /access-code|loginForm|输入访问码/);
});
