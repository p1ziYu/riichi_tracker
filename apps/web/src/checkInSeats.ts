import { ApiError } from './api.ts';

export type CheckInMember = {
  principalId: string;
  displayName: string;
  isOwner: boolean;
  seatNo: number | null;
  wind: string | null;
};

export type CheckInRoom = {
  match: { id: string; playerCount: number; status: string };
  caller: { principalId: string; isOwner: boolean; isMember: boolean };
  members: CheckInMember[];
  seating: { drawn: boolean; dealerSeatNo: number | null; memberCount: number; seatedCount: number };
  seats?: { seatNo: number; principalId: string | null; displayName: string | null; status: string }[];
};

export function checkInBody(token: string, alias: string): { token: string; alias?: string } {
  const name = alias.trim();
  return { token, ...(name ? { alias: name } : {}) };
}

const messages: Record<string, string> = {
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

export function flowError(cause: unknown): string {
  return cause instanceof ApiError && cause.code && messages[cause.code]
    ? messages[cause.code] : '操作失败，请稍后重试';
}

export const checkInError = flowError;
