import assert from 'node:assert/strict';
import test from 'node:test';
import { routeFromExternalUrl } from '../src/deepLinks.ts';

test('check-in link preserves the match and sign-in token', () => {
  assert.equal(routeFromExternalUrl('https://riichi.p1ziyu.com/checkin/match-1?token=abc%2Fdef'), '/checkin/match-1?token=abc%2Fdef');
});

test('links from another host cannot enter native check-in', () => {
  assert.equal(routeFromExternalUrl('https://other.example/checkin/match-1?token=abc'), null);
});

test('unrelated paths on the associated host cannot enter the app router', () => {
  assert.equal(routeFromExternalUrl('https://riichi.p1ziyu.com/table/match-1?token=abc'), null);
  assert.equal(routeFromExternalUrl('https://riichi.p1ziyu.com/checkin/'), null);
  assert.equal(routeFromExternalUrl('https://riichi.p1ziyu.com/checkin/match-1/other'), null);
});

test('HTTP links cannot enter native check-in', () => {
  assert.equal(routeFromExternalUrl('http://riichi.p1ziyu.com/checkin/match-1?token=abc'), null);
});

test('malformed external input cannot enter native check-in', () => {
  assert.equal(routeFromExternalUrl('not a URL'), null);
});
