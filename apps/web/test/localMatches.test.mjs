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
const { matchRulesPayload, ruleOverrides, ruleSummary, rulesError, snapshotRuleSummary } = await import('../src/rules.ts');

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
test('local setup persists player names and chosen East seat in the first hand and terminal tie order', () => {
  environment();
  const rules = seedRules(LOCAL_SEEDS[3]);
  const match = createLocalMatch(rules, '自选起家', LOCAL_SEEDS[3].key,
    { playerNames: ['阿一', '阿二', '阿三'], dealerSeatNo: 1 });
  assert.deepEqual(match.seats.map((seat) => seat.displayName), ['阿一', '阿二', '阿三']);
  assert.equal(match.currentHand.dealerSeatNo, 1);
  assert.equal(match.nextHand.dealerSeatNo, 1);
  assert.equal(getLocalMatch(match.id).currentHand.dealerSeatNo, 1);
  const tied = updateLocalMatch(match.id, (fresh) => finishLocalMatch({ ...fresh, points: [40000, 40000, 25000] }));
  const standings = previewLocalTerminal(tied).perSeat;
  assert.equal(standings.find((seat) => seat.seatNo === 1).rank, 1);
  assert.equal(standings.find((seat) => seat.seatNo === 0).rank, 2);
  assert.equal(createLocalMatch(rules, '默认起家').currentHand.dealerSeatNo, 0);
  assert.throws(() => createLocalMatch(rules, '错误起家', null, { dealerSeatNo: 3 }), /起家座位无效/);
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

test('local riichi changes consume per-seat budgets without revising or persisting rejected transitions', () => {
  const storage = environment();
  let match = create();
  assert.deepEqual(match.currentHand.seats.map((seat) => seat.riichiChangeUsage),
    Array.from({ length: 4 }, () => ({ declares: 0, cancels: 0 })));
  const change = (seatNo) => { match = updateLocalMatch(match.id, (fresh) => markLocalRiichi(fresh, seatNo)); };
  change(0);
  assert.equal(match.currentHand.markRevision, 1);
  assert.deepEqual(match.currentHand.seats[0].riichiChangeUsage, { declares: 1, cancels: 0 });
  change(0);
  assert.equal(match.currentHand.markRevision, 2);
  assert.deepEqual(match.currentHand.seats[0].riichiChangeUsage, { declares: 1, cancels: 1 });
  change(1);
  assert.deepEqual(match.currentHand.seats[1].riichiChangeUsage, { declares: 1, cancels: 0 });
  change(0);
  assert.equal(match.currentHand.markRevision, 4);
  assert.deepEqual(match.currentHand.seats[0].riichiChangeUsage, { declares: 2, cancels: 1 });
  const beforeCancel = storage.get(LOCAL_MATCHES_STORAGE_KEY);
  assert.throws(() => updateLocalMatch(match.id, (fresh) => markLocalRiichi(fresh, 0)), /取消次数已达上限/);
  assert.equal(storage.get(LOCAL_MATCHES_STORAGE_KEY), beforeCancel);
  assert.equal(getLocalMatch(match.id).currentHand.markRevision, 4);
  const beforeDeclare = storage.get(LOCAL_MATCHES_STORAGE_KEY);
  const mismatched = { ...match, currentHand: { ...match.currentHand,
    seats: match.currentHand.seats.map((seat) => seat.seatNo === 0 ? { ...seat, isRiichi: false } : seat) } };
  assert.throws(() => markLocalRiichi(mismatched, 0), /声明次数已达上限/);
  assert.equal(mismatched.currentHand.markRevision, 4);
  assert.deepEqual(mismatched.currentHand.seats[0].riichiChangeUsage, { declares: 2, cancels: 1 });
  assert.equal(storage.get(LOCAL_MATCHES_STORAGE_KEY), beforeDeclare);
  assert.deepEqual(getLocalMatch(match.id).currentHand.seats[0].riichiChangeUsage, { declares: 2, cancels: 1 });
  const draw = { kind: 'ryuukyoku', winners: [], tenpai: [true, true, false, false] };
  match = updateLocalMatch(match.id, (fresh) => settleLocalHand(fresh, draw));
  assert.deepEqual(match.results[0].hand.seats[0].riichiChangeUsage, { declares: 2, cancels: 1 });
  match = updateLocalMatch(match.id, openLocalHand);
  assert.equal(match.currentHand.markRevision, 0);
  assert.deepEqual(match.currentHand.seats.map((seat) => seat.riichiChangeUsage),
    Array.from({ length: 4 }, () => ({ declares: 0, cancels: 0 })));
  change(0);
  assert.deepEqual(getLocalMatch(match.id).currentHand.seats[0].riichiChangeUsage, { declares: 1, cancels: 0 });
});

test('legacy local hand seats derive initial riichi usage; persisted usage must be valid', () => {
  const storage = environment();
  let match = create();
  match = updateLocalMatch(match.id, (fresh) => markLocalRiichi(fresh, 0));
  match = updateLocalMatch(match.id, (fresh) => settleLocalHand(fresh,
    { kind: 'ryuukyoku', winners: [], tenpai: [true, false, false, false] }));
  match = updateLocalMatch(match.id, openLocalHand);
  match = updateLocalMatch(match.id, (fresh) => markLocalRiichi(fresh, 1));
  const legacy = JSON.parse(storage.get(LOCAL_MATCHES_STORAGE_KEY));
  for (const hand of [legacy.matches[0].currentHand, legacy.matches[0].results[0].hand]) {
    for (const seat of hand.seats) delete seat.riichiChangeUsage;
  }
  storage.set(LOCAL_MATCHES_STORAGE_KEY, JSON.stringify(legacy));
  let loaded = getLocalMatch(match.id);
  assert.deepEqual(loaded.currentHand.seats[1].riichiChangeUsage, { declares: 1, cancels: 0 });
  assert.deepEqual(loaded.currentHand.seats[2].riichiChangeUsage, { declares: 0, cancels: 0 });
  assert.deepEqual(loaded.results[0].hand.seats[0].riichiChangeUsage, { declares: 1, cancels: 0 });
  assert.deepEqual(loaded.results[0].hand.seats[2].riichiChangeUsage, { declares: 0, cancels: 0 });
  loaded = updateLocalMatch(match.id, (fresh) => markLocalRiichi(fresh, 1));
  loaded = updateLocalMatch(match.id, (fresh) => markLocalRiichi(fresh, 1));
  assert.deepEqual(getLocalMatch(match.id).currentHand.seats[1].riichiChangeUsage, { declares: 2, cancels: 1 });
  assert.deepEqual(getLocalMatch(match.id).results[0].hand.seats[0].riichiChangeUsage, { declares: 1, cancels: 0 });

  const valid = storage.get(LOCAL_MATCHES_STORAGE_KEY);
  for (const usage of [{ declares: 3, cancels: 1 }, { declares: 2, cancels: -1 },
    { declares: 1.5, cancels: 0 }, { declares: 0, cancels: 0 }]) {
    const data = JSON.parse(valid);
    data.matches[0].currentHand.seats[1].riichiChangeUsage = usage;
    const invalid = JSON.stringify(data);
    storage.set(LOCAL_MATCHES_STORAGE_KEY, invalid);
    assert.throws(() => getLocalMatch(match.id), /不完整/);
    assert.equal(storage.get(LOCAL_MATCHES_STORAGE_KEY), invalid);
    storage.set(LOCAL_MATCHES_STORAGE_KEY, valid);
  }
  const badResult = JSON.parse(valid);
  badResult.matches[0].results[0].hand.seats[0].riichiChangeUsage = { declares: 3, cancels: 0 };
  storage.set(LOCAL_MATCHES_STORAGE_KEY, JSON.stringify(badResult));
  assert.throws(() => getLocalMatch(match.id), /不完整/);
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
  match = updateLocalMatch(match.id, (fresh) => ({ ...fresh, points: [31000, 24000, 24000, 21000] }));
  match = updateLocalMatch(match.id, (fresh) => markLocalRiichi(fresh, 0));
  match = updateLocalMatch(match.id, finishLocalMatch);
  assert.equal(match.currentHand, null);
  assert.equal(match.results.length, 0);
  assert.equal(previewLocalTerminal(match).unclaimedRiichiPoints, 0);
  match = updateLocalMatch(match.id, confirmLocalTerminal);
  assert.equal(match.settlementConfirmed, true);
  assert.throws(() => finishLocalMatch(match), /已经结束/);
  deleteLocalMatch(match.id);
  assert.equal(getLocalMatch(match.id), null);
  assert.equal(listLocalMatches().length, 0);

  match = create();
  match = updateLocalMatch(match.id, (fresh) => ({ ...fresh, points: [31000, 24000, 24000, 21000] }));
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
  assert.equal(wrc.rules.bustEndsGame, false);
  assert.equal(wrc.rules.multiRon, 'head_bump');
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

test('canonical defaults, diff, reset and template switches preserve per-match intent', () => {
  const base = seedRules(LOCAL_SEEDS[0]);
  const customized = { ...base, targetPoints: 35000, honbaRon: 600, honbaPerPayer: 200,
    kiriageMangan: false, uma: [20, 10, -10, -20] };
  assert.deepEqual(ruleOverrides(base, base), {});
  assert.deepEqual(matchRulesPayload('version-1', base, base), { rulesetVersionId: 'version-1' });
  assert.deepEqual(ruleOverrides(base, customized), {
    targetPoints: 35000, uma: [20, 10, -10, -20], honbaRon: 600, honbaPerPayer: 200, kiriageMangan: false,
  });
  assert.equal(ruleSummary('四麻国际竞技参考', base, customized).changes.length, 5);
  assert.equal(ruleSummary('四麻国际竞技参考', base, customized).title, '基于〈四麻国际竞技参考〉+ 自定义 5 项');
  assert.deepEqual(matchRulesPayload('version-1', base, customized), {
    rulesetVersionId: 'version-1', rulesOverride: ruleOverrides(base, customized),
  });
  assert.deepEqual(ruleOverrides(base, { ...base, uma: [...base.uma] }), {});
  const nextTemplate = seedRules(LOCAL_SEEDS[2]);
  assert.deepEqual(ruleOverrides(nextTemplate, { ...nextTemplate, uma: [...nextTemplate.uma] }), {});
  assert.equal(nextTemplate.startingPoints, 25000);
  assert.equal(rulesError({ ...base, notenPenaltyTotal: 1500 }), '流局罚符需能按听牌人数逐笔整百分摊。');
});

test('custom local snapshot stores full engine policies, never seed overrides; settlement uses edited math', () => {
  environment();
  const base = seedRules(LOCAL_SEEDS[0]);
  const adjusted = { ...base, honbaRon: 600, honbaPerPayer: 200, notenPenaltyTotal: 6000,
    multiRon: 'double_ron', targetPoints: 35000, fixedSouth4EndPolicy: 'target_or_bust',
    terminalRiichiPoolPolicy: 'first', uma: [20, 10, -10, -20] };
  let match = createLocalMatch(adjusted, LOCAL_SEEDS[0].name, LOCAL_SEEDS[0].key);
  assert.equal(match.rulesSnapshot.config.honbaRon, 600);
  assert.equal(match.rulesSnapshot.config.notenPenaltyTotal, 6000);
  assert.equal(match.rulesSnapshot.config.fixedSouth4EndPolicy, 'target_or_bust');
  assert.equal(match.rulesSnapshot.config.metadata.overrideKeys.length, 8);
  const summary = snapshotRuleSummary(match.rulesSnapshot.config, 'fallback');
  assert.equal(summary.changes.length, 8);
  assert.match(summary.changes.join('、'), /荒牌流局罚符总额：6,000/);
  const output = previewLocalHand(match, { kind: 'ryuukyoku', winners: [], tenpai: [true, false, false, false] });
  assert.equal(output.perSeat[0].netPoints, 6000);
  match = settleLocalHand(match, { kind: 'ryuukyoku', winners: [], tenpai: [true, false, false, false] });
  assert.equal(match.points[0], 36000);
  assert.equal(match.points[1], 28000);
  match = finishLocalMatch(match);
  const terminal = previewLocalTerminal(match);
  assert.equal(terminal.isGameEnd, true);
  assert.equal(terminal.perSeat[0].umaTenths, 200);
});

test('old local records remain readable with legacy rule projection and intact snapshot policies', () => {
  const storage = environment();
  const created = createLocalMatch(seedRules(LOCAL_SEEDS[0]), 'old', LOCAL_SEEDS[0].key);
  const data = JSON.parse(storage.get(LOCAL_MATCHES_STORAGE_KEY));
  data.matches[0].rules = { playerCount: 4, startingPoints: 30000, returnPoints: 30000,
    endTarget: 40000, uma: [15, 5, -5, -15], ryuukyokuPoolTotal: 6000, honbaPerPayer: 200,
    kiriageMangan: false, kazoeYakuman: true, sanmaTsumoLoss: false, bustEndsMatch: false, doubleRon: true };
  data.matches[0].rulesSnapshot.config = { ...created.rulesSnapshot.config, targetPoints: 30000,
    notenPenaltyTotal: 6000, honbaRon: 600, honbaPerPayer: 200, multiRon: 'double_ron',
    oka: 0, fixedSouth4EndPolicy: 'completed_south_4' };
  storage.set(LOCAL_MATCHES_STORAGE_KEY, JSON.stringify(data));
  const migrated = getLocalMatch(created.id);
  assert.equal(migrated.rules.targetPoints, 40000);
  assert.equal(migrated.rulesSnapshot.config.targetPoints, 40000);
  assert.equal(migrated.rulesSnapshot.config.fixedSouth4EndPolicy, 'completed_south_4');
  assert.equal(migrated.rulesSnapshot.config.honbaRon, 600);
});

test('target-or-bust local finish requires configured end condition', () => {
  environment();
  const base = seedRules(LOCAL_SEEDS[2]);
  const match = createLocalMatch(base, 'house', LOCAL_SEEDS[2].key);
  assert.throws(() => finishLocalMatch(match), /目标点/);
  assert.throws(() => finishLocalMatch({ ...match, points: [26000, 25000, 25000, 24000] }), /目标点/);
  const reached = finishLocalMatch({ ...match, points: [30000, 24000, 24000, 22000] });
  assert.equal(previewLocalTerminal(reached).isGameEnd, true);
  const bust = finishLocalMatch({ ...match, points: [35000, 35000, 31000, -1000] });
  assert.equal(previewLocalTerminal(bust).isGameEnd, true);
});
