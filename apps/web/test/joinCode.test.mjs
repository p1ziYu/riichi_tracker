import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ApiError } from '../src/api.ts';
import { checkInRoute, isValidJoinCode, joinCodeError, joinCodePath, normalizeJoinCode, resolveJoinCode } from '../src/joinCode.ts';

const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;

afterEach(() => {
  globalThis.window = previousWindow;
  globalThis.fetch = previousFetch;
});

test('room codes normalize to uppercase and validate the API alphabet and exact length', () => {
  assert.equal(normalizeJoinCode(' abcd23 '), 'ABCD23');
  assert.equal(isValidJoinCode(normalizeJoinCode('abcd23')), true);
  assert.equal(isValidJoinCode('ABCDEFG'), false);
  assert.equal(isValidJoinCode('ABC23'), false);
  assert.equal(isValidJoinCode('ABCI23'), false);
  assert.equal(isValidJoinCode('ABCO23'), false);
  assert.equal(isValidJoinCode('ABC123'), false);
  assert.equal(isValidJoinCode('ABC023'), false);
  assert.equal(isValidJoinCode('ABC-23'), false);
  assert.equal(isValidJoinCode('ABC中23'), false);
});

test('lookup uses the public GET route and preserves the returned check-in token', async () => {
  globalThis.window = { location: new URL('https://riichi.p1ziyu.com/') };
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/matches/by-code/ABCD23');
    assert.equal(options.method, undefined);
    return new Response(JSON.stringify({ matchId: 'match-1', token: 'a+/=b', expiresAt: '2026-10-23T12:00:00Z' }));
  };
  const match = await resolveJoinCode(normalizeJoinCode(' abcd23 '));
  assert.equal(joinCodePath('ABCD23'), '/api/matches/by-code/ABCD23');
  assert.equal(match.expiresAt, '2026-10-23T12:00:00Z');
  assert.equal(checkInRoute(match), '/checkin/match-1?token=a%2B%2F%3Db');
  assert.equal(checkInRoute({ ...match, matchId: 'match/2' }), '/checkin/match%2F2?token=a%2B%2F%3Db');
});

test('lookup maps codes first and uses generic copy for missing or unknown codes', () => {
  assert.equal(joinCodeError(new ApiError(404, 'private', 'join_code_not_found')), '房间码不正确，或牌桌已结束。');
  assert.equal(joinCodeError(new ApiError(429, 'private', 'rate_limited')), '尝试过于频繁，请稍后再试。');
  assert.equal(joinCodeError(new ApiError(409, 'private', 'match_already_started')), '牌局已开始，无法加入。');
  assert.equal(joinCodeError(new ApiError(404, 'private', 'rate_limited')), '尝试过于频繁，请稍后再试。');
  assert.equal(joinCodeError(new ApiError(404, 'private')), '操作失败，请稍后重试');
  assert.equal(joinCodeError(new ApiError(404, 'private server detail', 'unknown_code')), '操作失败，请稍后重试');
  assert.equal(joinCodeError(new Error('private network detail')), '操作失败，请稍后重试');
});
