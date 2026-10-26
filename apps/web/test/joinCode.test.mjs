import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ApiError } from '../src/api.ts';
import { errorTextZh } from '../src/errors.ts';
import { checkinPath, isValidJoinCode, joinCodePath, normalizeJoinCode, resolveJoinCode, shareUrl } from '../src/joinCode.ts';

const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;

globalThis.window = { location: new URL('https://riichi.p1ziyu.com') };

afterEach(() => {
  globalThis.window = { location: new URL('https://riichi.p1ziyu.com') };
  globalThis.fetch = previousFetch;
});

test('normalize uppercases and trims; alphabet excludes I, O, 0, 1', () => {
  assert.equal(normalizeJoinCode('  ab2345 '), 'AB2345');
  assert.equal(isValidJoinCode('ABC234'), true);
  assert.equal(isValidJoinCode('ABC23'), false);
  assert.equal(isValidJoinCode('ABC2345'), false);
  assert.equal(isValidJoinCode('ABCI45'), false);
  assert.equal(isValidJoinCode('ABCO45'), false);
  assert.equal(isValidJoinCode('ABC045'), false);
  assert.equal(isValidJoinCode('ABC145'), false);
});

test('share links carry the room code in ?token= and checkin paths round-trip', () => {
  assert.equal(shareUrl('match-1', 'ABC234'), 'https://riichi.p1ziyu.com/checkin/match-1?token=ABC234');
  assert.equal(checkinPath('match-1', 'ABC234'), '/checkin/match-1?token=ABC234');
  assert.equal(checkinPath('match-1'), '/checkin/match-1');
  assert.equal(joinCodePath('ABC234'), '/api/matches/by-code/ABC234');
});

test('resolveJoinCode returns the match id and token; failures map to Chinese', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/matches/by-code/ABC234');
    return { ok: true, status: 200, text: async () => JSON.stringify({ matchId: 'match-1', token: 'tok', expiresAt: '2026-01-01T00:00:00Z' }) };
  };
  assert.deepEqual(await resolveJoinCode('ABC234'), { matchId: 'match-1', token: 'tok', expiresAt: '2026-01-01T00:00:00Z' });

  globalThis.fetch = async () => ({
    ok: false, status: 404, text: async () => JSON.stringify({ error: 'join_code_not_found', message: 'Join code not found' }),
  });
  await assert.rejects(resolveJoinCode('ZZZZZZ'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(errorTextZh(error), '找不到该房间码的牌局');
    return true;
  });
});
