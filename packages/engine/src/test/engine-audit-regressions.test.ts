import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  calculateSettlement as settle,
  calculateTerminalSettlement as terminal,
  normalizeRulesConfig,
  isAutomaticMatchEnd,
  ENGINE_VERSION, HOUSE_4P_V1, HOUSE_3P_V1, WRC_4P_REF_V1, COMMON_3P_REF_V1,
  type HandState, type RulesSnapshot, type SettlementOutput, type WinnerInput,
} from '../index.js';

const rules = (config: Record<string, unknown>): RulesSnapshot => ({ rulesHash: 'audit', config });
const hand = (count: 3 | 4): HandState => ({
  handId: 'audit', roundWind: 'E', roundNumber: 1, dealerSeatNo: 0,
  honba: 0, riichiPool: 0,
  seats: Array.from({ length: count }, (_, seatNo) => ({
    seatNo, points: count === 3 ? 35000 : 25000, isRiichi: false, isTenpai: false,
  })),
  markRevision: 0n, resultRevision: 0n,
});
function net(out: SettlementOutput): number[] {
  for (const seat of out.perSeat) {
    assert.ok(Number.isInteger(seat.netPoints / 100));
  }
  return out.perSeat.map((seat) => seat.netPoints);
}

describe('deep engine audit regressions', () => {
  it('H1: only the actual ron discarder can void a declaration stick', () => {
    const h = hand(4);
    h.seats[2].isRiichi = true;
    h.seats[3].isRiichi = true;
    const winner = { seatNo: 1, han: 2, fu: 30, dealInSeatNo: 2 };
    assert.throws(() => settle(rules({ ...HOUSE_4P_V1 }), h, {
      kind: 'ron', winners: [winner], riichiDeclarationDealInSeatNo: 3,
    }, ENGINE_VERSION), /riichiDeclarationDealInSeatNo/);
    assert.throws(() => settle(rules({ ...HOUSE_4P_V1 }), h, {
      kind: 'tsumo', winners: [{ seatNo: 1, han: 1, fu: 30 }], riichiDeclarationDealInSeatNo: 2,
    }, ENGINE_VERSION), /riichiDeclarationDealInSeatNo/);
    assert.deepEqual(net(settle(rules({ ...HOUSE_4P_V1 }), h, {
      kind: 'ron', winners: [winner],
    }, ENGINE_VERSION)), [0, 4000, -3000, -1000]);
    assert.deepEqual(net(settle(rules({ ...HOUSE_4P_V1 }), h, {
      kind: 'ron', winners: [winner], riichiDeclarationDealInSeatNo: 2,
    }, ENGINE_VERSION)), [0, 3000, -2000, -1000]);
  });

  it('rejects malformed and contradictory declaration flags for one ron discard', () => {
    const h = hand(4);
    h.seats[2].isRiichi = true;
    const winner: WinnerInput = { seatNo: 1, han: 2, fu: 30, dealInSeatNo: 2 };
    const settleRon = (winners: WinnerInput[], seatNo?: number) => settle(
      rules({ ...HOUSE_4P_V1 }), h,
      { kind: 'ron', winners, ...(seatNo !== undefined ? { riichiDeclarationDealInSeatNo: seatNo } : {}) },
      ENGINE_VERSION,
    );
    assert.throws(() => settleRon([{ ...winner, isRiichiDeclarationDealIn: false }], 2),
      /Conflicting riichi declaration deal-in flags/);
    assert.throws(() => settleRon([
      { ...winner, isRiichiDeclarationDealIn: true },
      { ...winner, seatNo: 3, isRiichiDeclarationDealIn: false },
    ]), /Conflicting riichi declaration deal-in flags/);
    assert.throws(() => settleRon([{ ...winner, isRiichiDeclarationDealIn: 'false' as unknown as boolean }]),
      /isRiichiDeclarationDealIn must be a boolean/);
    const invalid = hand(4);
    invalid.seats[3].isRiichi = true; // A different marked seat cannot stand in for the actual discarder.
    assert.throws(() => settle(rules({ ...HOUSE_4P_V1 }), invalid, {
      kind: 'ron', winners: [{ ...winner, isRiichiDeclarationDealIn: true }],
    }, ENGINE_VERSION), /marked ron deal-in seat/);
    const explicit = settleRon([winner], 2);
    const perWinner = settleRon([{ ...winner, isRiichiDeclarationDealIn: true }]);
    assert.deepEqual(perWinner, explicit);
    assert.deepEqual(net(explicit), [0, 2000, -2000, 0]);
    assert.equal(explicit.perSeat[2].breakdown.some((entry) => entry.reason === 'riichi'), false);
  });

  it('H2: ongoing match keeps its pool and has no terminal award', () => {
    const out = terminal({ points: [21000, 29000, 29000, 20000], riichiPool: 1000,
      requireTargetPoints: true, startingDealerSeatNo: 1 }, rules({ ...HOUSE_4P_V1 }));
    assert.equal(out.isGameEnd, false);
    assert.equal(out.gameEndReason, 'not_ended');
    assert.equal(out.unclaimedRiichiPoints, 1000);
    assert.equal(out.poolRecipientSeatNo, null);
    assert.deepEqual(out.perSeat.map((s) => s.finalPoints), [21000, 29000, 29000, 20000]);
    assert.deepEqual(out.tenths, []);
    assert.deepEqual(out.standings, []);
  });

  it('H3: a four-player template key cannot become three-player defaults', () => {
    assert.throws(() => settle(rules({ templateKey: 'house_4p_v1' }), hand(3),
      { kind: 'tsumo', winners: [{ seatNo: 1, han: 1, fu: 30 }] }, ENGINE_VERSION), /Seat count mismatch/);
    assert.throws(() => normalizeRulesConfig({ templateKey: 'house_4p_v1', playerCount: 3 }), /Seat count mismatch/);
  });

  it('validates canonical point and uma constraints before settlement', () => {
    for (const config of [
      { startingPoints: 0 },
      { returnPoints: -100 },
      { targetPoints: 25950 },
      { uma: [10.01, 0, -5, -5.01] },
    ]) {
      assert.throws(() => normalizeRulesConfig({ ...HOUSE_4P_V1, ...config }), /Invalid/);
    }
    assert.equal(normalizeRulesConfig({ ...HOUSE_4P_V1, doubleYakuman: true }).doubleYakuman, true);
  });

  it('M4: non-divisible four-player noten totals fail at normalization, never substitute another total', () => {
    assert.throws(() => normalizeRulesConfig({ ...HOUSE_4P_V1, notenPenaltyTotal: 2000 }), /notenPenaltyTotal/);
    for (const tenpai of [[true, false, false, false], [true, true, true, false]]) {
      assert.throws(() => settle(rules({ ...HOUSE_4P_V1, notenPenaltyTotal: 2000 }), hand(4),
        { kind: 'ryuukyoku', winners: [], tenpai }, ENGINE_VERSION), /notenPenaltyTotal/);
    }
  });

  it('M5: compensated three-player dealer tsumo uses the rounded four-player total; child too', () => {
    const h = hand(3);
    h.honba = 1;
    const config = rules({ ...COMMON_3P_REF_V1, tsumoLoss: false });
    assert.deepEqual(net(settle(config, h, { kind: 'tsumo', winners: [{ seatNo: 0, han: 1, fu: 30 }] },
      ENGINE_VERSION)), [1700, -900, -800]);
    assert.deepEqual(net(settle(config, h, { kind: 'tsumo', winners: [{ seatNo: 1, han: 1, fu: 30 }] },
      ENGINE_VERSION)), [-800, 1300, -500]);
  });

  it('M6: ordinary composites and special double yakuman have separate permissions', () => {
    const winner = { seatNo: 1, dealInSeatNo: 2, han: 1, fu: 30, yakumanCount: 2 };
    function ron(config: Record<string, unknown>, w: WinnerInput = winner): number[] {
      const out = settle(rules(config), hand(4), { kind: 'ron', winners: [w] }, ENGINE_VERSION);
      assert.equal(out.nextHand.riichiPool, 0);
      return net(out);
    }
    assert.deepEqual(ron({ ...HOUSE_4P_V1, compositeYakuman: false, doubleYakuman: true }),
      [0, 32000, -32000, 0]);
    assert.deepEqual(ron({ ...HOUSE_4P_V1, compositeYakuman: true, doubleYakuman: false }),
      [0, 64000, -64000, 0]);
    assert.deepEqual(ron({ ...HOUSE_4P_V1, compositeYakuman: false, doubleYakuman: true },
      { ...winner, yakumanCount: 0, doubleYakumanCount: 1 }), [0, 64000, -64000, 0]);
    assert.deepEqual(ron({ ...HOUSE_4P_V1, compositeYakuman: true, doubleYakuman: true },
      { ...winner, yakumanCount: 1, doubleYakumanCount: 1 }), [0, 96000, -96000, 0]);
    assert.deepEqual(ron({ ...HOUSE_4P_V1, compositeYakuman: false, doubleYakuman: true },
      { ...winner, yakumanCount: 1, doubleYakumanCount: 1 }), [0, 64000, -64000, 0]);
    assert.throws(() => ron({ ...HOUSE_4P_V1 }, { ...winner, yakumanCount: 0, doubleYakumanCount: 1 }),
      /Special double yakuman/);
  });

  it('M7: riichi-marked noten dealer requires manual draw adjudication', () => {
    const h = hand(3);
    h.honba = 2;
    h.riichiPool = 1000;
    h.seats[0].isRiichi = true;
    assert.throws(() => settle(rules({ ...HOUSE_3P_V1 }), h,
      { kind: 'ryuukyoku', winners: [], tenpai: [false, true, false] }, ENGINE_VERSION),
    /manual adjudication/);
  });

  it('requires manual adjudication of a noten riichi mark on enabled nagashi draws too', () => {
    const h = hand(3);
    h.seats[0].isRiichi = true;
    const config = rules({ ...HOUSE_3P_V1, nagashiManganEnabled: true });
    const winners = [{ seatNo: 1, han: 5, fu: 30 }];
    assert.throws(() => settle(config, h, {
      kind: 'nagashi_mangan', winners, tenpai: [false, true, false],
      nagashiEligibility: [{ seatNo: 1, discards: [{ tile: '9s', called: false }] }],
    }, ENGINE_VERSION), /Riichi seat 0 is noten: manual adjudication required/);
    const valid = settle(config, h, {
      kind: 'nagashi_mangan', winners, tenpai: [true, true, false],
      nagashiEligibility: [{ seatNo: 1, discards: [{ tile: '9s', called: false }] }],
    }, ENGINE_VERSION);
    assert.deepEqual(net(valid), [-5000, 6000, -2000]);
    assert.equal(valid.nextHand.riichiPool, 1000);
    assert.equal(valid.nextHand.dealerSeatNo, 0);
  });

  it('L8: negative fu is invalid even for yakuman', () => {
    assert.throws(() => settle(rules({ ...HOUSE_4P_V1 }), hand(4),
      { kind: 'ron', winners: [{ seatNo: 1, dealInSeatNo: 0, han: 1, fu: -1, yakumanCount: 1 }] },
      ENGINE_VERSION), /Invalid fu/);
  });

  it('L9: manual adjudication validates units and every keyed seat', () => {
    const cases: { payments: Record<number, number>; error: RegExp }[] = [
      { payments: { 0: 1, 1: -1 }, error: /multiple of 100/ },
      { payments: { 0: 1000, 1: -1000, 99: -999999 }, error: /Invalid manual payment seat: 99/ },
      { payments: { 0: 1000, 1: -1000, 99: -999900 }, error: /Invalid manual payment seat: 99/ },
    ];
    for (const { payments, error } of cases) {
      assert.throws(() => settle(rules({ ...HOUSE_4P_V1 }), hand(4),
        { kind: 'chombo', winners: [], manualPayments: payments }, ENGINE_VERSION), error);
    }
  });

  it('L10: the P0 house seed rejects automatic nagashi unless enabled', () => {
    const h = hand(4);
    h.riichiPool = 1000;
    h.seats[2].isRiichi = true;
    h.seats[2].isTenpai = true;
    const result = { kind: 'nagashi_mangan' as const, winners: [{ seatNo: 1, han: 5, fu: 30 }],
      nagashiEligibility: [{ seatNo: 1, discards: [{ tile: '1p', called: false }] }] };
    assert.throws(() => settle(rules({ ...HOUSE_4P_V1 }), h, result, ENGINE_VERSION),
      /Automatic nagashi mangan is disabled/);
    assert.deepEqual(net(settle(rules({ ...HOUSE_4P_V1, nagashiManganEnabled: true }), h, result,
      ENGINE_VERSION)), [-4000, 8000, -3000, -2000]);
  });
});

describe('reference rules conformance', () => {
  it('normalizes distinct house and reference policies with explicit overrides', () => {
    const house = normalizeRulesConfig({});
    assert.equal(house.fixedSouth4EndPolicy, 'target_or_bust');
    assert.equal(house.terminalRiichiPoolPolicy, 'first');
    assert.equal(house.tiedUmaPolicy, 'seat_order');
    assert.equal(house.nagashiDealerRepeatRequiresTenpai, false);
    const wrc = normalizeRulesConfig({ templateKey: 'wrc_4p_ref_v1' });
    assert.equal(wrc.fixedSouth4EndPolicy, 'completed_south_4');
    assert.equal(wrc.terminalRiichiPoolPolicy, 'unallocated');
    assert.equal(wrc.tiedUmaPolicy, 'split');
    assert.equal(wrc.kiriageMangan, true);
    assert.equal(wrc.allowLowPointRiichi, true);
    assert.equal(wrc.bustEndsGame, false);
    const tenhou = normalizeRulesConfig({ templateKey: 'common_3p_ref_v1' });
    assert.equal(tenhou.doubleRonHonbaPolicy, 'nearest_only');
    assert.equal(tenhou.nagashiManganEnabled, true);
    assert.equal(tenhou.nagashiDealerRepeatRequiresTenpai, true);
    assert.equal(tenhou.tsumoLoss, true);
    assert.equal(tenhou.kazoeYakuman, true);
    assert.equal(normalizeRulesConfig({ templateKey: 'wrc_4p_ref_v1',
      terminalRiichiPoolPolicy: 'first', tiedUmaPolicy: 'seat_order',
      fixedSouth4EndPolicy: 'target_or_bust' }).terminalRiichiPoolPolicy, 'first');
  });

  it('WRC head-bumps both double and triple ron, never aborting the triple', () => {
    const h = hand(4);
    h.honba = 2;
    h.riichiPool = 1000;
    const config = rules({ templateKey: 'wrc_4p_ref_v1' });
    const winners = [3, 2, 1].map((seatNo) => ({ seatNo, dealInSeatNo: 0, han: 1, fu: 30 }));
    for (const claims of [winners.slice(0, 2), winners]) {
      const out = settle(config, h, { kind: 'ron', winners: claims }, ENGINE_VERSION);
      assert.equal(out.nextHand.riichiPool, 0);
      assert.equal(out.nextHand.dealerSeatNo, 1);
      assert.equal(out.nextHand.honba, 0);
      assert.deepEqual(net(out), claims.length === 2
        ? [-1600, 0, 2600, 0] : [-1600, 2600, 0, 0]);
    }
    assert.deepEqual(net(settle(rules({ ...HOUSE_4P_V1 }), h,
      { kind: 'ron', winners }, ENGINE_VERSION)), [0, 0, 0, 0]);
  });

  it('WRC finishes only on confirmed South 4, retains pool, and splits tied uma by rank', () => {
    const config = rules({ templateKey: 'wrc_4p_ref_v1' });
    const points = [31000, 31000, 29000, 28000];
    const pending = terminal(points, config, { riichiPool: 1000, requireTargetPoints: false });
    assert.equal(pending.isGameEnd, false);
    const finished = terminal(points, config, { riichiPool: 1000, completedSouth4: true });
    assert.equal(finished.isGameEnd, true);
    if (!finished.isGameEnd) throw new Error('South 4 must complete.');
    assert.equal(finished.gameEndReason, 'final_round_complete');
    assert.equal(finished.poolRecipientSeatNo, null);
    assert.deepEqual(finished.standings.map((s) => s.rank), [1, 1, 3, 4]);
    assert.deepEqual(finished.standings.map((s) => s.umaTenths), [100, 100, -50, -150]);
    assert.deepEqual(finished.tenths, [110, 110, -60, -170]);
    assert.equal(finished.tenths.reduce((sum, n) => sum + n, 0) + finished.unclaimedRiichiPoints / 100, 0);
    const negative = terminal([-1000, 50000, 36000, 35000], config);
    assert.equal(negative.isGameEnd, false);
    const remainder = terminal([30000, 30000, 30000, 30000],
      rules({ ...WRC_4P_REF_V1, uma: [15.1, 5, -5.1, -15] }), { completedSouth4: true });
    assert.equal(remainder.isGameEnd, true);
    if (!remainder.isGameEnd) throw new Error('South 4 must complete.');
    assert.deepEqual(remainder.standings.map((s) => s.umaTenths), [0, 0, 0, 0]);
    const partial = terminal([31000, 31000, 29000, 29000],
      rules({ ...WRC_4P_REF_V1, uma: [15.1, 5, -5.1, -15] }), { completedSouth4: true });
    assert.equal(partial.isGameEnd, true);
    if (!partial.isGameEnd) throw new Error('South 4 must complete.');
    assert.deepEqual(partial.standings.map((s) => s.umaTenths), [101, 100, -100, -101]);
  });

  it('WRC permits riichi below 1000 and kiriage on 4/30 and 3/60; house does neither', () => {
    const h = hand(4);
    h.seats[1].points = 500;
    h.seats[1].isRiichi = true;
    const wrc = rules({ templateKey: 'wrc_4p_ref_v1' });
    const out = settle(wrc, h, { kind: 'ron', winners: [{ seatNo: 2, dealInSeatNo: 0, han: 4, fu: 30 }] },
      ENGINE_VERSION);
    assert.deepEqual(net(out), [-8000, -1000, 9000, 0]);
    assert.equal(h.seats[1].points + out.perSeat[1].netPoints, -500);
    assert.throws(() => settle(rules({ ...HOUSE_4P_V1 }), h,
      { kind: 'ron', winners: [{ seatNo: 2, dealInSeatNo: 0, han: 4, fu: 30 }] }, ENGINE_VERSION),
    /cannot confirm riichi/);
    const h2 = hand(4);
    assert.deepEqual(net(settle(wrc, h2,
      { kind: 'ron', winners: [{ seatNo: 2, dealInSeatNo: 0, han: 3, fu: 60 }] },
      ENGINE_VERSION)), [-8000, 0, 8000, 0]);
  });

  it('Tenhou allocates double-ron honba and pool only to nearest winner', () => {
    const h = hand(3);
    h.honba = 2;
    h.riichiPool = 1000;
    const out = settle(rules({ templateKey: 'common_3p_ref_v1' }), h,
      { kind: 'ron', winners: [
        { seatNo: 2, dealInSeatNo: 0, han: 1, fu: 30 },
        { seatNo: 1, dealInSeatNo: 0, han: 1, fu: 30 },
      ] }, ENGINE_VERSION);
    assert.deepEqual(net(out), [-2400, 2400, 1000]);
  });

  it('Tenhou nagashi requires each winner’s uncalled terminal/honor river, replaces noten transfer', () => {
    const h = hand(3);
    const config = rules({ templateKey: 'common_3p_ref_v1' });
    const winners = [{ seatNo: 0, han: 5, fu: 30 }, { seatNo: 1, han: 5, fu: 30 }];
    const eligibility = [
      { seatNo: 0, discards: [{ tile: '1m', called: false }, { tile: '7z', called: false }] },
      { seatNo: 1, discards: [{ tile: '9p', called: false }] },
    ];
    const result = { kind: 'nagashi_mangan' as const, winners, tenpai: [false, true, false], nagashiEligibility: eligibility };
    assert.throws(() => settle(config, h, { ...result, nagashiEligibility: undefined }, ENGINE_VERSION),
      /complete discard history/);
    assert.throws(() => settle(config, h, { ...result, nagashiEligibility: eligibility.slice(0, 1) },
      ENGINE_VERSION), /complete discard history/);
    for (const invalid of [{ tile: '2m', called: false }, { tile: '1m', called: true },
      { tile: '8z', called: false }]) {
      assert.throws(() => settle(config, h, { ...result, nagashiEligibility: [
        eligibility[0], { seatNo: 1, discards: [invalid] },
      ] }, ENGINE_VERSION), /called or non-terminal\/honor/);
    }
    const out = settle(config, h, result, ENGINE_VERSION);
    assert.deepEqual(net(out), [4000, 2000, -6000]);
    assert.equal(out.nextHand.dealerSeatNo, 1); // Dealer was noten despite winning nagashi.
    const overridden = settle(rules({ templateKey: 'common_3p_ref_v1',
      nagashiDealerRepeatRequiresTenpai: false }), h, result, ENGINE_VERSION);
    assert.equal(overridden.nextHand.dealerSeatNo, 0);
    const houseStrict = settle(rules({ ...HOUSE_3P_V1, nagashiManganEnabled: true,
      nagashiDealerRepeatRequiresTenpai: true }), h, result, ENGINE_VERSION);
    assert.equal(houseStrict.nextHand.dealerSeatNo, 1);
    assert.equal(out.nextHand.honba, 1);
    assert.equal(out.perSeat.some((s) => s.breakdown.some((entry) => entry.reason.includes('noten') ||
      entry.reason.includes('tenpai'))), false);
  });
  it('Tenhou auto-stops only at dealer first-place stop, candidate threshold, bust or West-three cap', () => {
    const h = hand(3);
    h.roundWind = 'S';
    h.roundNumber = 3;
    h.dealerSeatNo = 2;
    const tsumo = { kind: 'tsumo' as const, winners: [{ seatNo: 2, han: 1, fu: 30 }] };
    const repeat = { roundWind: 'S' as const, roundNumber: 3, dealerSeatNo: 2, honba: 1, riichiPool: 0 };
    const west = { ...repeat, roundWind: 'W' as const, roundNumber: 1, dealerSeatNo: 0 };
    const end = (config: Record<string, unknown>, result: typeof tsumo | { kind: 'ryuukyoku'; winners: []; tenpai: boolean[] },
      next: typeof repeat | typeof west, values: number[]) =>
      isAutomaticMatchEnd(config, h, result, next, values.map((points, seatNo) => ({ seatNo, points })));
    assert.equal(end({ ...HOUSE_3P_V1 }, tsumo, repeat, [30000, 34000, 41000]), false);
    assert.equal(end({ ...COMMON_3P_REF_V1 }, tsumo, repeat, [30000, 34000, 41000]), true);
    assert.equal(end({ ...COMMON_3P_REF_V1 }, tsumo, repeat, [35000, 36000, 34000]), false);
    assert.equal(end({ ...COMMON_3P_REF_V1 }, { kind: 'ryuukyoku', winners: [], tenpai: [false, false, true] },
      repeat, [32000, 35000, 38000]), true);
    assert.equal(end({ ...COMMON_3P_REF_V1 }, { kind: 'ryuukyoku', winners: [], tenpai: [false, false, false] },
      west, [33000, 35000, 37000]), false);
    assert.equal(end({ ...COMMON_3P_REF_V1 }, { kind: 'ryuukyoku', winners: [], tenpai: [false, false, false] },
      west, [30000, 35000, 40000]), true);
    assert.equal(end({ ...COMMON_3P_REF_V1 }, tsumo, repeat, [-100, 30000, 75100]), true);
    h.roundWind = 'W'; h.roundNumber = 3;
    assert.equal(end({ ...COMMON_3P_REF_V1 }, tsumo, repeat, [34000, 35000, 36000]), true);
  });
});
