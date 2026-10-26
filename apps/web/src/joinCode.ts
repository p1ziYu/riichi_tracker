import { api } from './api.ts';

export const normalizeJoinCode = (value: string): string => value.trim().toUpperCase();

export function isValidJoinCode(code: string): boolean {
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code);
}

export type JoinCodeMatch = { matchId: string; token: string; expiresAt: string };

export function joinCodePath(code: string): string {
  return `/api/matches/by-code/${encodeURIComponent(code)}`;
}

export function resolveJoinCode(code: string): Promise<JoinCodeMatch> {
  return api<JoinCodeMatch>(joinCodePath(code));
}

// Share links carry the lifelong room code in ?token= (the server accepts a
// token value equal to the room code as the code), so a shared link or QR
// never expires while the table is waiting.
export function shareUrl(matchId: string, code: string): string {
  return `${window.location.origin}/checkin/${encodeURIComponent(matchId)}?token=${encodeURIComponent(code)}`;
}

export function checkinPath(matchId: string, token?: string): string {
  return token
    ? `/checkin/${encodeURIComponent(matchId)}?token=${encodeURIComponent(token)}`
    : `/checkin/${encodeURIComponent(matchId)}`;
}
