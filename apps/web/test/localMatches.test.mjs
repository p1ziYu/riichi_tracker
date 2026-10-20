import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, test } from 'node:test';

// Node's TS loader does not resolve the extensionless import used by Vite.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === './rules' && context.parentURL?.endsWith('/localMatches.ts')) {
    return nextResolve('./rules.ts', context);
  }
  return nextResolve(specifier, context);
} });
const {
  LOCAL_MATCHES_STORAGE_KEY, LOCAL_SEEDS, seedRules, createLocalMatch, deleteLocalMatch,
  finishLocalMatch, getLocalMatch, listLocalMatches, markLocalRiichi, openLocalHand,
  previewLocalHand, previewLocalTerminal, settleLocalHand, updateLocalMatch, confirmLocalTerminal,
} = await import('../src/localMatches.ts');

const originalStorage = globalThis.localStorage;
const originalWindow = globalThis.window;
function environment() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  globalThis.window = new EventTarget();
  return values;
}
function create() { return createLocalMatch(seedRules(LOCAL_SEEDS[2]), '牌桌'); }
afterEach(() => {
  globalThis.localStorage = originalStorage;
  globalThis.window = originalWindow;
});

test('corrupt, partial and future-version records fail safely without overwriting stored data', () => {
  const values = environment();
  for (const raw of ['', '{', JSON.stringify({ version: 2, matches: [] }), JSON.stringify({ version: 1, matches: [null] })]) {
    values.set(LOCAL_MATCHES_STORAGE_KEY, raw);
    assert.throws(() => listLocalMatches());
    assert.throws(() => getLocalMatch('local-any'));
    assert.throws(() => create());
    assert.equal(values.get(LOCAL_MATCHES_STORAGE_KEY), raw);
  }
  values.clear();
  const valid = create();
  const payload = JSON.parse(values.get(LOCAL_MATCHES_STORAGE_KEY));
  payload.matches[0].seats = [null];
  const raw = JSON.stringify(payload);
  values.set(LOCAL_MATCHES_STORAGE_KEY, raw);
  assert.throws(() => listLocalMatches(), /不完整/);
  assert.equal(values.get(LOCAL_MATCHES_STORAGE_KEY), raw);
  assert.equal(valid.seats.length, 4);
});

test('riichi pool and honba carry across draw, hand open and next win; persisted seat edits use fresh records', () => {
  environment();
  let match = create();
  match = updateLocalMatch(match.id, (fresh) => markLocalRiichi(fresh, 1));
  match = updateLocalMatch(match.id, (fresh) => ({ ...fresh, seats: fresh.seats.map((s) =>
    s.seatNo === 0 ? { ...s, displayName: '东家' } : s) }));
  const draw = { kind: 'ryuukyoku', winners: [], tenpai: [false, true, false, false] };
  const first = previewLocalHand(match, draw);
  assert.equal(first.nextHand.riichiPool, 1000);
  assert.equal(first.nextHand.honba, 1);
  assert.equal(first.nextHand.dealerSeatNo, 1);
  match = updateLocalMatch(match.id, (fresh) => settleLocalHand(fresh, draw));
  assert.equal(match.points[1], match.rules.startingPoints + 2000);
  assert.equal(match.seats[0].displayName, '东家');
  match = updateLocalMatch(match.id, openLocalHand);
  assert.equal(match.currentHand.riichiPool, 1000);
  assert.equal(match.currentHand.honba, 1);
  assert.equal(match.currentHand.seats[1].points, match.points[1]);
  const ron = { kind: 'ron', winners: [{ seatNo: 2, han: 2, fu: 30, dealInSeatNo: 0 }] };
  const second = previewLocalHand(match, ron);
  assert.equal(second.nextHand.riichiPool, 0);
  assert.equal(second.nextHand.honba, 0);
  assert.ok(second.perSeat.find((seat) => seat.seatNo === 2).breakdown.some((part) => part.reason === 'riichi_pool'));
  match = updateLocalMatch(match.id, (fresh) => settleLocalHand(fresh, ron));
  assert.equal(match.points.reduce((sum, points) => sum + points, 0), match.rules.startingPoints * 4);
  assert.equal(getLocalMatch(match.id).results.length, 2);
});

test('finish voids open hand and uncharged marks; terminal awards unclaimed pool and finished match remains deletable', () => {
  environment();
  let match = create();
  match = updateLocalMatch(match.id, (fresh) => markLocalRiichi(fresh, 0));
  match = updateLocalMatch(match.id, finishLocalMatch);
  assert.equal(match.currentHand, null);
  assert.equal(match.points[0], match.rules.startingPoints);
  assert.equal(match.results.length, 0);
  assert.equal(previewLocalTerminal(match).unclaimedRiichiPoints, 0);
  match = updateLocalMatch(match.id, confirmLocalTerminal);
  assert.equal(match.settlementConfirmed, true);
  assert.throws(() => finishLocalMatch(match), /已经结束/);
  deleteLocalMatch(match.id);
  assert.equal(getLocalMatch(match.id), null);
  assert.equal(listLocalMatches().length, 0);

  match = create();
  match = updateLocalMatch(match.id, (fresh) => markLocalRiichi(fresh, 1));
  match = updateLocalMatch(match.id, (fresh) => settleLocalHand(fresh,
    { kind: 'ryuukyoku', winners: [], tenpai: [false, true, false, false] }));
  match = updateLocalMatch(match.id, finishLocalMatch);
  const terminal = previewLocalTerminal(match);
  assert.equal(terminal.unclaimedRiichiPoints, 1000);
  assert.equal(terminal.isGameEnd, true);
  assert.equal(terminal.perSeat.reduce((sum, seat) => sum + seat.finalPoints, 0), match.rules.startingPoints * 4);
  assert.equal(updateLocalMatch(match.id, confirmLocalTerminal).terminal.unclaimedRiichiPoints, 1000);
});

test('reference local seeds retain their engine policies instead of projecting house defaults', () => {
  environment();
  const wrc = createLocalMatch(seedRules(LOCAL_SEEDS[0]), 'WRC', LOCAL_SEEDS[0].key);
  assert.equal(wrc.rules.kiriageMangan, true);
  assert.equal(wrc.rules.bustEndsMatch, false);
  assert.equal(wrc.rules.doubleRon, false);
  assert.equal(wrc.rulesSnapshot.config.templateKey, 'wrc_4p_ref_v1');
  assert.equal(wrc.rulesSnapshot.config.multiRon, 'head_bump');
  assert.equal(wrc.rulesSnapshot.config.terminalRiichiPoolPolicy, 'unallocated');
  assert.equal(wrc.rulesSnapshot.config.tiedUmaPolicy, 'split');
  assert.equal(wrc.rulesSnapshot.config.fixedSouth4EndPolicy, 'completed_south_4');
  assert.equal(wrc.rulesSnapshot.config.automaticEndPolicy, 'manual');
  assert.equal(wrc.rulesSnapshot.config.allowLowPointRiichi, true);
  assert.equal(wrc.rulesSnapshot.config.kiriageMangan, true);
  const tenhou = createLocalMatch(seedRules(LOCAL_SEEDS[1]), 'Tenhou', LOCAL_SEEDS[1].key);
  assert.equal(tenhou.rulesSnapshot.config.templateKey, 'common_3p_ref_v1');
  assert.equal(tenhou.rulesSnapshot.config.doubleRonHonbaPolicy, 'nearest_only');
  assert.equal(tenhou.rulesSnapshot.config.nagashiManganEnabled, true);
  assert.equal(tenhou.rulesSnapshot.config.nagashiDealerRepeatRequiresTenpai, true);
  assert.equal(tenhou.rulesSnapshot.config.automaticEndPolicy, 'ranked_sanma');
  assert.equal(tenhou.rulesSnapshot.config.tsumoLoss, true);
  assert.equal(tenhou.rulesSnapshot.config.kazoeYakuman, true);
  assert.equal(tenhou.rulesSnapshot.config.notenPenaltyTotal, 2000);
});

test('WRC local scoring uses head-bump ron and kiriage mangan', () => {
  environment();
  const match = createLocalMatch(seedRules(LOCAL_SEEDS[0]), 'WRC hands', LOCAL_SEEDS[0].key);
  const ron = previewLocalHand(match, { kind: 'ron', winners: [
    { seatNo: 1, han: 4, fu: 30, dealInSeatNo: 0 },
    { seatNo: 2, han: 4, fu: 30, dealInSeatNo: 0 },
  ] });
  assert.equal(ron.perSeat[1].netPoints, 8000);
  assert.equal(ron.perSeat[2].netPoints, 0);
  assert.equal(ron.perSeat[0].netPoints, -8000);
});

test('Tenhou local double ron awards honba to the nearest winner only', () => {
  environment();
  const match = createLocalMatch(seedRules(LOCAL_SEEDS[1]), 'Tenhou honba', LOCAL_SEEDS[1].key);
  const output = previewLocalHand({ ...match, currentHand: { ...match.currentHand, honba: 1 } }, {
    kind: 'ron', winners: [
      { seatNo: 1, han: 1, fu: 30, dealInSeatNo: 0 },
      { seatNo: 2, han: 1, fu: 30, dealInSeatNo: 0 },
    ],
  });
  assert.equal(output.perSeat[1].breakdown.find((part) => part.reason === 'honba_win')?.amount, 200);
  assert.equal(output.perSeat[2].breakdown.some((part) => part.reason === 'honba_win'), false);
});

test('WRC low-point riichi is admitted, fixed South 4 must rotate, and outstanding sticks stay unallocated', () => {
  environment();
  let match = createLocalMatch(seedRules(LOCAL_SEEDS[0]), 'WRC', LOCAL_SEEDS[0].key);
  assert.throws(() => finishLocalMatch(match), /南四局/);
  match = { ...match, points: [30000, 30000, 30000, 500], currentHand: {
    ...match.currentHand, seats: match.currentHand.seats.map((seat) =>
      seat.seatNo === 3 ? { ...seat, points: 500 } : seat),
  } };
  match = markLocalRiichi(match, 3);
  const lowPoint = previewLocalHand(match, { kind: 'ryuukyoku', winners: [], tenpai: [true, true, true, true] });
  assert.equal(lowPoint.nextHand.riichiPool, 1000);
  assert.throws(() => markLocalRiichi({ ...match, rulesSnapshot: {
    ...match.rulesSnapshot, config: { ...match.rulesSnapshot.config, allowLowPointRiichi: false },
  }, currentHand: { ...match.currentHand, seats: match.currentHand.seats.map((seat) =>
    seat.seatNo === 3 ? { ...seat, isRiichi: false } : seat) } }, 3), /点数不足/);

  match = createLocalMatch(seedRules(LOCAL_SEEDS[0]), 'WRC end', LOCAL_SEEDS[0].key);
  match = { ...match, currentHand: { ...match.currentHand, roundWind: 'S', roundNumber: 4, dealerSeatNo: 3 },
    nextHand: { ...match.nextHand, roundWind: 'S', roundNumber: 4, dealerSeatNo: 3 } };
  match = markLocalRiichi(match, 3);
  match = settleLocalHand(match, { kind: 'ryuukyoku', winners: [], tenpai: [true, true, true, true] });
  assert.equal(match.nextHand.roundWind, 'S');
  assert.throws(() => finishLocalMatch(match), /南四局/);
  match = { ...match, currentHand: openLocalHand(match).currentHand };
  match = settleLocalHand(match, { kind: 'ryuukyoku', winners: [], tenpai: [true, true, true, false] });
  assert.equal(match.nextHand.roundWind, 'W');
  assert.throws(() => openLocalHand(match), /南四局已结束/);
  match = finishLocalMatch(match);
  const terminal = previewLocalTerminal(match);
  assert.equal(terminal.unclaimedRiichiPoints, 1000);
  assert.equal(terminal.perSeat.reduce((sum, seat) => sum + seat.finalPoints, 0) + 1000, 120000);
  assert.equal(terminal.isGameEnd, true);
});

test('WRC tied raw points split the combined uma in local terminal standings', () => {
  environment();
  let match = createLocalMatch(seedRules(LOCAL_SEEDS[0]), 'WRC ties', LOCAL_SEEDS[0].key);
  match = { ...match, currentHand: { ...match.currentHand, roundWind: 'S', roundNumber: 4, dealerSeatNo: 3 },
    nextHand: { ...match.nextHand, roundWind: 'S', roundNumber: 4, dealerSeatNo: 3 } };
  match = settleLocalHand(match, { kind: 'ryuukyoku', winners: [], tenpai: [true, true, true, false] });
  match = { ...match, nextHand: { ...match.nextHand, roundWind: 'W', roundNumber: 1 },
    points: [31000, 31000, 31000, 27000] };
  const terminal = previewLocalTerminal(finishLocalMatch(match));
  assert.deepEqual(terminal.perSeat.map((seat) => seat.umaTenths), [50, 50, 50, -150]);
});

test('Tenhou local nagashi requires attested terminal and honor discards and replaces noten settlement', () => {
  environment();
  const match = createLocalMatch(seedRules(LOCAL_SEEDS[1]), 'Tenhou nagashi', LOCAL_SEEDS[1].key);
  const claim = { kind: 'nagashi_mangan', winners: [{ seatNo: 0, han: 5, fu: 30 }], tenpai: [false, false, false] };
  assert.throws(() => previewLocalHand(match, claim), /discard history/);
  assert.throws(() => previewLocalHand(match, { ...claim,
    nagashiEligibility: [{ seatNo: 0, discards: [{ tile: '1m', called: true }] }],
  }), /called/);
  const output = previewLocalHand(match, { ...claim,
    nagashiEligibility: [{ seatNo: 0, discards: [{ tile: '1m', called: false }, { tile: '1z', called: false }] }],
  });
  assert.ok(output.perSeat[0].netPoints > 0);
  assert.equal(output.nextHand.dealerSeatNo, 1);
  assert.ok(output.perSeat.every((seat) => seat.breakdown.every((part) => part.reason !== 'noten')));
});

test('ranked sanma locally auto-finishes on all-last dealer win; house stays manually finished', () => {
  environment();
  for (const [index, expected] of [[1, 'finished'], [3, 'active']]) {
    const seed = LOCAL_SEEDS[index];
    const match = createLocalMatch(seedRules(seed), `all-last ${index}`, seed.key);
    const allLast = { ...match, currentHand: {
      ...match.currentHand, roundWind: 'S', roundNumber: 3, dealerSeatNo: 2,
    } };
    const settled = settleLocalHand(allLast, {
      kind: 'tsumo', winners: [{ seatNo: 2, han: 1, fu: 30 }],
    });
    assert.equal(settled.status, expected);
    assert.equal(settled.currentHand, null);
    assert.ok(settled.points[2] > settled.points[0]);
  }
});
