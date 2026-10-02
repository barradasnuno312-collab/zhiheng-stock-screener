import { test } from 'node:test';
import assert from 'node:assert/strict';
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
