import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PASSWORD_HINT } from '../src/passwordRules.ts';

test('password hint matches the better-auth 1.7.11 enforced range exactly', () => {
  assert.equal(PASSWORD_HINT, '密码至少 8 位，最多 128 位');
});
