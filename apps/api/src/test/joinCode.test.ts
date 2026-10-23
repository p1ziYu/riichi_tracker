import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateJoinCode, JOIN_CODE_ALPHABET, normalizeJoinCode } from '../joinCode.js';
import { JoinCodeRateLimiter } from '../rateLimit.js';

describe('join codes', () => {
  it('generates six characters from the unambiguous 32-character alphabet', () => {
    assert.equal(JOIN_CODE_ALPHABET.length, 32);
    const observed = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const code = generateJoinCode();
      assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
      observed.add(code);
    }
    assert.ok(observed.size > 1, 'random codes must not all be identical');
  });

  it('accepts trimmed lowercase codes and rejects ambiguous or malformed values', () => {
    assert.equal(normalizeJoinCode('  ab23xy  '), 'AB23XY');
    for (const input of ['AIO234', 'AB0123', 'ABCDE', 'ABCDEFG', 'ABC-23', 'KBC234', '💠💠💠💠💠💠']) {
      assert.equal(normalizeJoinCode(input), null);
    }
  });
});

describe('join code lookup limiter', () => {
  it('counts failures separately from successes, expires windows and isolates IPs', () => {
    const limiter = new JoinCodeRateLimiter();
    for (let i = 0; i < 10; i++) {
      assert.equal(limiter.check('one', i), null);
      assert.equal(limiter.recordFailure('one', i), null);
    }
    assert.equal(limiter.check('one', 10), null, 'a valid code remains resolvable after failures');
    assert.equal(limiter.recordFailure('one', 10), 600);
    assert.equal(limiter.check('two', 10), null);
    assert.equal(limiter.check('one', 600_000), null);
    assert.equal(limiter.recordFailure('one', 600_000), null);
  });

  it('limits all lookups to sixty per minute, including successful resolutions', () => {
    const limiter = new JoinCodeRateLimiter();
    for (let i = 0; i < 60; i++) assert.equal(limiter.check('one', 1_000), null);
    assert.equal(limiter.check('one', 1_000), 60);
    assert.equal(limiter.check('one', 61_000), null);
  });
});
