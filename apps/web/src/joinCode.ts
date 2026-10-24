import { api } from './api.ts';
import { flowError } from './checkInSeats.ts';

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
  return flowError(error);
}

export function resolveJoinCode(code: string): Promise<JoinCodeMatch> {
  return api<JoinCodeMatch>(joinCodePath(code));
}
