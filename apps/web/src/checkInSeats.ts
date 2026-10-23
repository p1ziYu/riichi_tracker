import { ApiError, errorText } from './api.ts';

export type CheckInRoom = {
  match: { id: string; playerCount: number; status: string };
  seats: { seatNo: number; principalId: string | null; displayName: string | null; status: string }[];
};

export function checkInBody(token: string, alias: string, seatNo: number | null): { token: string; alias?: string; seatNo?: number } {
  const name = alias.trim();
  return { token, ...(name ? { alias: name } : {}), ...(seatNo !== null ? { seatNo } : {}) };
}

export function checkInError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'seat_taken') return '该座位刚被占用，请重新选择。';
    if (cause.code === 'match_full') return '座位已满，暂时无法加入。';
    if (cause.code === 'match_already_started') return '牌局已开始，无法加入。';
    if (cause.code === 'token_consumed_or_expired' || cause.code === 'invalid_token') {
      return '签到链接无效或已过期，请房主重新分享链接，或使用房间码。';
    }
  }
  return errorText(cause);
}
