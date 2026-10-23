import { randomInt } from 'node:crypto';

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;
const JOIN_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/i;

export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeJoinCode(input: string): string | null {
  const trimmed = input.trim();
  return JOIN_CODE_PATTERN.test(trimmed) ? trimmed.toUpperCase() : null;
}
