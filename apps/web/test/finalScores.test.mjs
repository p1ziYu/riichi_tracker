import assert from 'node:assert/strict';
import test from 'node:test';
import { appendKey, parseScore, rankScores, totalFor, validateScores, windsFor } from '../src/finalScores.ts';

test('totals: 4p sums to 1000, 3p sums to 1050', () => {
  assert.equal(totalFor('4p'), 1000);
  assert.equal(totalFor('3p'), 1050);
  assert.deepEqual(windsFor('4p'), ['E', 'S', 'W', 'N']);
  assert.deepEqual(windsFor('3p'), ['E', 'S', 'W']);
});

test('ranks: higher score first, ties broken by wind order E > S > W > N', () => {
  assert.deepEqual(
    rankScores([
      { wind: 'N', score: 300 },
      { wind: 'E', score: 300 },
      { wind: 'S', score: 400 },
      { wind: 'W', score: 100 },
    ]),
    [
      { wind: 'E', score: 300, rank: 2 },
      { wind: 'S', score: 400, rank: 1 },
      { wind: 'W', score: 100, rank: 4 },
      { wind: 'N', score: 300, rank: 3 },
    ],
  );
});

test('validation: incomplete, out of range, and total mismatch are rejected', () => {
  assert.equal(validateScores('4p', ['250', '250', '250', '']).ok, false);
  assert.equal(validateScores('4p', ['250', '250', '250', '10000']).ok, false);
  assert.equal(validateScores('4p', ['250', '250', '250', '-10000']).ok, false);
  const mismatch = validateScores('4p', ['250', '250', '250', '200']);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.match(mismatch.reason, /1000/);
  assert.deepEqual(validateScores('4p', ['400', '300', '200', '100']), { ok: true, total: 1000 });
  assert.deepEqual(validateScores('3p', ['500', '400', '150']), { ok: true, total: 1050 });
  // Negatives and zero are allowed.
  assert.deepEqual(validateScores('4p', ['1200', '0', '-100', '-100']), { ok: true, total: 1000 });
});

test('parseScore: empty and non-numeric are null, leading zeros parse', () => {
  assert.equal(parseScore(''), null);
  assert.equal(parseScore('-'), null);
  assert.equal(parseScore('abc'), null);
  assert.equal(parseScore('007'), 7);
  assert.equal(parseScore('-5'), -5);
  assert.equal(parseScore('0'), 0);
});

test('keypad: digits cap at 4, minus toggles, back deletes', () => {
  assert.equal(appendKey('', '1'), '1');
  assert.equal(appendKey('9999', '9'), '9999');
  assert.equal(appendKey('999', '9'), '9999');
  assert.equal(appendKey('', '-'), '-');
  assert.equal(appendKey('-', '5'), '-5');
  assert.equal(appendKey('-5', '-'), '5');
  assert.equal(appendKey('0', '5'), '5');
  assert.equal(appendKey('-0', '5'), '-5');
  assert.equal(appendKey('123', 'back'), '12');
  assert.equal(appendKey('-', 'back'), '');
  assert.equal(appendKey('12', 'x'), '12');
});
