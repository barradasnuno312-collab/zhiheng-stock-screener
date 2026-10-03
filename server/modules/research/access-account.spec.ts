import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, normalizeUsername, passwordMatches, usernameRef } from './access-account';

test('account names normalize consistently for unique lookup', () => {
  assert.equal(normalizeUsername('  Research_User  '), 'research_user');
  assert.equal(usernameRef('Research_User'), usernameRef(' research_user '));
  assert.notEqual(usernameRef('research_user'), usernameRef('another_user'));
  assert.match(usernameRef('research_user'), /^[a-f0-9-]{36}$/);
});

test('account passwords use salted scrypt hashes and reject incorrect values', async () => {
  const first = await hashPassword('long-password-123');
  const second = await hashPassword('long-password-123');
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.passwordHash, second.passwordHash);
  assert.equal(await passwordMatches('long-password-123', first.salt, first.passwordHash), true);
  assert.equal(await passwordMatches('wrong-password', first.salt, first.passwordHash), false);
});
