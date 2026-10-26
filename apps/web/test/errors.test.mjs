import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ApiError } from '../src/api.ts';
import { errorTextZh } from '../src/errors.ts';

const cases = [
  ['match_not_found', '找不到该牌局，可能已被删除'],
  ['match_full', '牌桌已满员'],
  ['match_already_started', '牌局已开始，无法加入；已入座请从战绩进入'],
  ['invalid_join_code', '房间码不正确，请重新输入'],
  ['join_code_not_found', '找不到该房间码的牌局'],
  ['total_mismatch', '合计点数不正确，请核对后再保存'],
  ['score_out_of_range', '得点须在 -9999 至 9999 之间'],
  ['rate_limited', '尝试过于频繁，请稍后再试'],
  ['INVALID_EMAIL_OR_PASSWORD', '邮箱或密码不正确'],
  ['USER_ALREADY_EXISTS', '该邮箱已注册，请直接登录'],
];

test('known error codes map to Chinese copy', () => {
  for (const [code, copy] of cases) {
    assert.equal(errorTextZh(new ApiError(400, 'raw english message', code)), copy);
  }
});

test('mapped copy never leaks English API text', () => {
  for (const [code] of cases) {
    const copy = errorTextZh(new ApiError(400, 'Some English server text', code));
    assert.ok(!/[A-Za-z]/.test(copy), `${code} leaked latin letters: ${copy}`);
  }
});

test('unknown codes fall back by status, never to the raw message', () => {
  assert.equal(errorTextZh(new ApiError(401, 'No active session', 'weird_code')), '请先登录');
  assert.equal(errorTextZh(new ApiError(403, 'Access denied', 'weird_code')), '没有权限进行此操作');
  assert.equal(errorTextZh(new ApiError(500, 'Internal server error', 'weird_code')), '服务端异常，请稍后再试');
  assert.equal(errorTextZh(new Error('boom')), '请求失败，请重试');
  assert.equal(errorTextZh(new Error('Failed to fetch')), '网络连接失败，请检查网络后重试');
});

afterEach(() => {});
