import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/api.ts';
import { checkInBody, checkInError } from '../src/checkInSeats.ts';

test('auto-assign omits the seat number; explicit seat zero is retained and nickname whitespace is trimmed', () => {
  assert.deepEqual(checkInBody('signed-token', '   ', null), { token: 'signed-token' });
  assert.deepEqual(checkInBody('signed-token', '  小明  ', 0), { token: 'signed-token', alias: '小明', seatNo: 0 });
  assert.deepEqual(checkInBody('signed-token', '', 3), { token: 'signed-token', seatNo: 3 });
});

test('direct join errors give actionable responses for taken seats, full rooms, started rooms and expired tokens', () => {
  assert.match(checkInError(new ApiError(409, 'Occupied', 'seat_taken')), /重新选择/);
  assert.match(checkInError(new ApiError(409, 'Full', 'match_full')), /座位已满/);
  assert.match(checkInError(new ApiError(409, 'Started', 'match_already_started')), /已开始/);
  assert.match(checkInError(new ApiError(400, 'Expired', 'token_consumed_or_expired')), /重新分享链接/);
  assert.equal(checkInError(new ApiError(500, '服务器繁忙', 'server_error')), '服务器繁忙');
});
