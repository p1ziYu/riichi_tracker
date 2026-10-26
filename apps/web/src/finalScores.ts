import type { Mode } from './types';

export const WINDS_4 = ['E', 'S', 'W', 'N'];
export const WINDS_3 = ['E', 'S', 'W'];

export const WIND_LABEL: Record<string, string> = { E: '东', S: '南', W: '西', N: '北' };

const WIND_ORDER: Record<string, number> = { E: 0, S: 1, W: 2, N: 3 };

export function windsFor(mode: Mode): string[] {
  return mode === '3p' ? [...WINDS_3] : [...WINDS_4];
}

export function totalFor(mode: Mode): number {
  return mode === '3p' ? 1050 : 1000;
}

export function rankLabel(rank: number): string {
  return ['一位', '二位', '三位', '四位'][rank - 1] ?? `${rank}位`;
}

// Rank rule (mirrors the server): higher score first; ties broken by wind
// order E > S > W > N. Ranks are positions 1..n, never shared.
export function rankScores(entries: { wind: string; score: number }[]): { wind: string; score: number; rank: number }[] {
  const ranked = [...entries].sort(
    (a, b) => b.score - a.score || (WIND_ORDER[a.wind] ?? 99) - (WIND_ORDER[b.wind] ?? 99),
  );
  const rankByWind = new Map(ranked.map((entry, index) => [entry.wind, index + 1]));
  return [...entries]
    .sort((a, b) => (WIND_ORDER[a.wind] ?? 99) - (WIND_ORDER[b.wind] ?? 99))
    .map((entry) => ({ wind: entry.wind, score: entry.score, rank: rankByWind.get(entry.wind) ?? 0 }));
}

export function parseScore(text: string): number | null {
  if (text === '') return null;
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  return Number.isSafeInteger(value) ? value : null;
}

export type ScoreValidation =
  | { ok: true; total: number }
  | { ok: false; total: number; reason: string };

export function validateScores(mode: Mode, texts: string[]): ScoreValidation {
  const total = totalFor(mode);
  const values: number[] = [];
  for (const text of texts) {
    const value = parseScore(text);
    if (value === null) return { ok: false, total, reason: '请完整填写每位玩家的终局得点' };
    if (value < -9999 || value > 9999) return { ok: false, total, reason: '得点须在 -9999 至 9999 之间' };
    values.push(value);
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (sum !== total) return { ok: false, total, reason: `合计须为 ${total}，当前为 ${sum}` };
  return { ok: true, total };
}

// On-screen keypad behaviour: digits append (max 4 digits), '-' toggles the
// sign, 'back' deletes one character. A lone '-' is kept while typing.
export function appendKey(current: string, key: string): string {
  if (key === 'back') return current.slice(0, -1);
  if (key === '-') return current.startsWith('-') ? current.slice(1) : `-${current}`;
  if (!/^[0-9]$/.test(key)) return current;
  const digits = current.replace('-', '');
  if (digits.length >= 4) return current;
  if (current === '0') return key;
  if (current === '-0') return `-${key}`;
  return `${current}${key}`;
}
