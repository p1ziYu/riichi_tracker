// better-auth 1.7.11 defaults, no config override in this repo (see
// apps/api/src/auth.ts emailAndPassword): enforced range is 8–128 chars,
// no character-kind rules. This hint must stay in sync with those defaults.
export const PASSWORD_HINT = '密码至少 8 位，最多 128 位';
