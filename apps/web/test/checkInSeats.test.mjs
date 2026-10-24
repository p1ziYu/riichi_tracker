import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/api.ts';
import { checkInBody, checkInError, flowError } from '../src/checkInSeats.ts';

test('check-in body sends only the invitation and an optional trimmed nickname', () => {
  assert.deepEqual(checkInBody('signed-token', '   '), { token: 'signed-token' });
  assert.deepEqual(checkInBody('signed-token', '  小明  '), { token: 'signed-token', alias: '小明' });
});

test('join, check-in and draw errors use designed copy by code without exposing server messages', () => {
  const copies = {
    match_full: '牌桌已满员，无法加入。',
    match_already_started: '牌局已开始，无法加入。',
    invalid_token: '签到链接无效或已过期，请房主重新分享链接，或使用房间码。',
    missing_token: '签到链接无效或已过期，请房主重新分享链接，或使用房间码。',
    token_consumed_or_expired: '签到链接无效或已过期，请房主重新分享链接，或使用房间码。',
    seat_claim_retired: '入座方式已更新，请刷新后重新加入。',
    owner_auto_check_in: '你是房主，已为你打开牌桌。',
    guest_already_bound: '当前访客身份已绑定其他牌桌，请使用原设备加入。',
    room_not_full: '人数尚未到齐，无法抽风定座。',
    seating_already_drawn: '已完成抽风定座。',
    seating_already_complete: '座位已确定，可直接开局。',
    forbidden: '只有房主可以执行此操作。',
    seat_empty: '该座位暂无成员。',
    invalid_seat: '座位选择无效。',
    member_not_found: '成员已不在牌桌中。',
    rate_limited: '尝试过于频繁，请稍后再试。',
    join_code_not_found: '房间码不正确，或牌桌已结束。',
    incomplete_check_ins: '成员尚未全部就座，无法开局。',
    invalid_dealer_seat: '起家座位无效。',
    match_not_found: '牌桌不存在或已被删除。',
    principal_inactive: '当前身份不可用，请重新进入。',
  };
  for (const [code, expected] of Object.entries(copies)) {
    assert.equal(flowError(new ApiError(409, 'Owner presence is confirmed on seat claim', code)), expected, code);
  }
  assert.equal(checkInError, flowError);
});

test('unknown codes and network failures show a generic fallback, not raw details', () => {
  for (const cause of [
    new ApiError(500, 'Owner presence is confirmed on seat claim', 'server_error'),
    new ApiError(503, 'private server detail'),
    new Error('private network detail'),
    'private non-error detail',
  ]) {
    assert.equal(flowError(cause), '操作失败，请稍后重试');
  }
});
