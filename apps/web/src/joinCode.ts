import { ApiError, api, errorText } from './api.ts';

export const normalizeJoinCode = (value: string): string => value.trim().toUpperCase();

export function isValidJoinCode(code: string): boolean {
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code);
}

export type JoinCodeMatch = { matchId: string; token: string; expiresAt: string };

export function joinCodePath(code: string): string {
  return `/api/matches/by-code/${encodeURIComponent(code)}`;
}

export function checkInRoute(match: JoinCodeMatch): string {
  return `/checkin/${encodeURIComponent(match.matchId)}?token=${encodeURIComponent(match.token)}`;
}

export function joinCodeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return '房间码无效，或对局已结束';
    if (error.status === 409) return '对局已开始，无法加入';
    if (error.status === 429) return '尝试过于频繁，请稍后再试';
  }
  return errorText(error);
}

export function resolveJoinCode(code: string): Promise<JoinCodeMatch> {
  return api<JoinCodeMatch>(joinCodePath(code));
}
