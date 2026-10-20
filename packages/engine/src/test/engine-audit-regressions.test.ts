import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  calculateSettlement as settle,
  calculateTerminalSettlement as terminal,
  normalizeRulesConfig,
  ENGINE_VERSION, HOUSE_4P_V1, HOUSE_3P_V1, COMMON_3P_REF_V1,
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
    }, ENGINE_VERSION), /Riichi seat 0 is noten: manual adjudication required/);
    const valid = settle(config, h, {
      kind: 'nagashi_mangan', winners, tenpai: [true, true, false],
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
    const result = { kind: 'nagashi_mangan' as const, winners: [{ seatNo: 1, han: 5, fu: 30 }] };
    assert.throws(() => settle(rules({ ...HOUSE_4P_V1 }), h, result, ENGINE_VERSION),
      /Automatic nagashi mangan is disabled/);
    assert.deepEqual(net(settle(rules({ ...HOUSE_4P_V1, nagashiManganEnabled: true }), h, result,
      ENGINE_VERSION)), [-4000, 8000, -3000, -2000]);
  });
});
