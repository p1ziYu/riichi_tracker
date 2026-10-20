import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  ENGINE_VERSION,
  HOUSE_4P_V1,
  WRC_4P_REF_V1,
  HOUSE_3P_V1,
  COMMON_3P_REF_V1,
  calculateSettlement,
  calculateTerminalSettlement,
  type HandState,
  type RulesSnapshot,
  type ResultInput,
  type SettlementOutput,
} from '../index.js';

function makeRules(config: Record<string, unknown>, rulesHash = 'test-hash'): RulesSnapshot {
  return { rulesHash, config };
}

function make4pHand(overrides: Partial<HandState> = {}): HandState {
  return {
    handId: 'hand-4p-1',
    roundWind: 'E',
    roundNumber: 1,
    dealerSeatNo: 0,
    honba: 0,
    riichiPool: 0,
    seats: [
      { seatNo: 0, points: 25000, isRiichi: false, isTenpai: null },
      { seatNo: 1, points: 25000, isRiichi: false, isTenpai: null },
      { seatNo: 2, points: 25000, isRiichi: false, isTenpai: null },
      { seatNo: 3, points: 25000, isRiichi: false, isTenpai: null },
    ],
    markRevision: 0n,
    resultRevision: 0n,
    ...overrides,
  };
}

function make3pHand(overrides: Partial<HandState> = {}): HandState {
  return {
    handId: 'hand-3p-1',
    roundWind: 'E',
    roundNumber: 1,
    dealerSeatNo: 0,
    honba: 0,
    riichiPool: 0,
    seats: [
      { seatNo: 0, points: 35000, isRiichi: false, isTenpai: null },
      { seatNo: 1, points: 35000, isRiichi: false, isTenpai: null },
      { seatNo: 2, points: 35000, isRiichi: false, isTenpai: null },
    ],
    markRevision: 0n,
    resultRevision: 0n,
    ...overrides,
  };
}

function assertZeroSumWithPool(out: SettlementOutput, poolBefore: number): void {
  const seatSum = out.perSeat.reduce((acc, s) => acc + s.netPoints, 0);
  const poolDelta = out.nextHand.riichiPool - poolBefore;
  assert.equal(seatSum + poolDelta, 0, `Expected seatSum (${seatSum}) + poolDelta (${poolDelta}) === 0`);
  for (const s of out.perSeat) {
    const breakdownSum = s.breakdown.reduce((acc, b) => acc + b.amount, 0);
    assert.equal(s.netPoints, breakdownSum, `Seat ${s.seatNo} netPoints must equal sum of breakdown amounts`);
  }
}

describe('Ron and Tsumo scoring matrix (4p & 3p)', () => {
  const rules4p = makeRules({ ...HOUSE_4P_V1 });

  it('matches the full 1-5 han x fu (25/30/40/60/70) matrix for non-dealer and dealer Ron & Tsumo', () => {
    // [han][fu] => [nonDealerRon, dealerRon, nonDealerTsumoKo, nonDealerTsumoOya, dealerTsumoAll]
    const matrix: Record<number, Record<number, [number, number, number, number, number]>> = {
      25: {
        1: [800, 1200, 200, 400, 400],
        2: [1600, 2400, 400, 800, 800],
        3: [3200, 4800, 800, 1600, 1600],
        4: [6400, 9600, 1600, 3200, 3200],
        5: [8000, 12000, 2000, 4000, 4000],
      },
      30: {
        1: [1000, 1500, 300, 500, 500],
        2: [2000, 2900, 500, 1000, 1000],
        3: [3900, 5800, 1000, 2000, 2000],
        4: [7700, 11600, 2000, 3900, 3900],
        5: [8000, 12000, 2000, 4000, 4000],
      },
      40: {
        1: [1300, 2000, 400, 700, 700],
        2: [2600, 3900, 700, 1300, 1300],
        3: [5200, 7700, 1300, 2600, 2600],
        4: [8000, 12000, 2000, 4000, 4000],
        5: [8000, 12000, 2000, 4000, 4000],
      },
      60: {
        1: [2000, 2900, 500, 1000, 1000],
        2: [3900, 5800, 1000, 2000, 2000],
        3: [7700, 11600, 2000, 3900, 3900],
        4: [8000, 12000, 2000, 4000, 4000],
        5: [8000, 12000, 2000, 4000, 4000],
      },
      70: {
        1: [2300, 3400, 600, 1200, 1200],
        2: [4500, 6800, 1200, 2300, 2300],
        3: [8000, 12000, 2000, 4000, 4000],
        4: [8000, 12000, 2000, 4000, 4000],
        5: [8000, 12000, 2000, 4000, 4000],
      },
    };

    for (const [fuStr, hanTable] of Object.entries(matrix)) {
      const fu = Number(fuStr);
      for (const [hanStr, expected] of Object.entries(hanTable)) {
        const han = Number(hanStr);
        const [koRon, oyaRon, koTsumoKo, koTsumoOya, oyaTsumoAll] = expected;

        // 1. Non-dealer Ron (seat 1 rons off seat 2, dealer is 0)
        const resKoRon = calculateSettlement(
          rules4p,
          make4pHand(),
          { kind: 'ron', winners: [{ seatNo: 1, han, fu, dealInSeatNo: 2 }] },
          ENGINE_VERSION,
        );
        assert.equal(resKoRon.perSeat[1].netPoints, koRon, `koRon ${han}han ${fu}fu`);
        assert.equal(resKoRon.perSeat[2].netPoints, -koRon, `koRon dealIn ${han}han ${fu}fu`);
        assertZeroSumWithPool(resKoRon, 0);

        // 2. Dealer Ron (seat 0 rons off seat 2, dealer is 0)
        const resOyaRon = calculateSettlement(
          rules4p,
          make4pHand(),
          { kind: 'ron', winners: [{ seatNo: 0, han, fu, dealInSeatNo: 2 }] },
          ENGINE_VERSION,
        );
        assert.equal(resOyaRon.perSeat[0].netPoints, oyaRon, `oyaRon ${han}han ${fu}fu`);
        assert.equal(resOyaRon.perSeat[2].netPoints, -oyaRon, `oyaRon dealIn ${han}han ${fu}fu`);
        assertZeroSumWithPool(resOyaRon, 0);

        // 3. Non-dealer Tsumo (seat 1 tsumos, dealer is 0)
        const resKoTsumo = calculateSettlement(
          rules4p,
          make4pHand(),
          { kind: 'tsumo', winners: [{ seatNo: 1, han, fu }] },
          ENGINE_VERSION,
        );
        assert.equal(resKoTsumo.perSeat[0].netPoints, -koTsumoOya, `koTsumo dealer pay ${han}han ${fu}fu`);
        assert.equal(resKoTsumo.perSeat[2].netPoints, -koTsumoKo, `koTsumo ko pay ${han}han ${fu}fu`);
        assert.equal(resKoTsumo.perSeat[3].netPoints, -koTsumoKo, `koTsumo ko pay ${han}han ${fu}fu`);
        assert.equal(resKoTsumo.perSeat[1].netPoints, koTsumoOya + 2 * koTsumoKo, `koTsumo win ${han}han ${fu}fu`);
        assertZeroSumWithPool(resKoTsumo, 0);

        // 4. Dealer Tsumo (seat 0 tsumos, dealer is 0)
        const resOyaTsumo = calculateSettlement(
          rules4p,
          make4pHand(),
          { kind: 'tsumo', winners: [{ seatNo: 0, han, fu }] },
          ENGINE_VERSION,
        );
        assert.equal(resOyaTsumo.perSeat[0].netPoints, 3 * oyaTsumoAll, `oyaTsumo win ${han}han ${fu}fu`);
        assert.equal(resOyaTsumo.perSeat[1].netPoints, -oyaTsumoAll);
        assert.equal(resOyaTsumo.perSeat[2].netPoints, -oyaTsumoAll);
        assert.equal(resOyaTsumo.perSeat[3].netPoints, -oyaTsumoAll);
        assertZeroSumWithPool(resOyaTsumo, 0);
      }
    }
  });

  it('rounds non-25 raw fu up to nearest 10 while keeping 25 fu exact (docs §2.2 & §12.1)', () => {
    // 2 han 25 fu non-dealer ron => 1600, NOT 2000
    const chiitoi = calculateSettlement(
      rules4p,
      make4pHand(),
      { kind: 'ron', winners: [{ seatNo: 1, han: 2, fu: 25, dealInSeatNo: 0 }] },
      ENGINE_VERSION,
    );
    assert.equal(chiitoi.perSeat[1].netPoints, 1600);

    // 2 han 22 fu (raw fu) rounds up to 30 fu => 2000
    const raw22 = calculateSettlement(
      rules4p,
      make4pHand(),
      { kind: 'ron', winners: [{ seatNo: 1, han: 2, fu: 22, dealInSeatNo: 0 }] },
      ENGINE_VERSION,
    );
    assert.equal(raw22.perSeat[1].netPoints, 2000);

    // 3 han 32 fu (raw fu) rounds up to 40 fu => 5200
    const raw32 = calculateSettlement(
      rules4p,
      make4pHand(),
      { kind: 'ron', winners: [{ seatNo: 1, han: 3, fu: 32, dealInSeatNo: 0 }] },
      ENGINE_VERSION,
    );
    assert.equal(raw32.perSeat[1].netPoints, 5200);
  });

  it('handles kiriage mangan flag for 4 han 30 fu and 3 han 60 fu (§12.1)', () => {
    const rulesKiriageOff = makeRules({ ...HOUSE_4P_V1, kiriageMangan: false });
    const rulesKiriageOn = makeRules({ ...HOUSE_4P_V1, kiriageMangan: true });

    const off430 = calculateSettlement(
      rulesKiriageOff,
      make4pHand(),
      { kind: 'ron', winners: [{ seatNo: 1, han: 4, fu: 30, dealInSeatNo: 2 }] },
      ENGINE_VERSION,
    );
    assert.equal(off430.perSeat[1].netPoints, 7700);

    const on430 = calculateSettlement(
      rulesKiriageOn,
      make4pHand(),
      { kind: 'ron', winners: [{ seatNo: 1, han: 4, fu: 30, dealInSeatNo: 2 }] },
      ENGINE_VERSION,
    );
    assert.equal(on430.perSeat[1].netPoints, 8000);

    const off360Dealer = calculateSettlement(
      rulesKiriageOff,
      make4pHand(),
      { kind: 'ron', winners: [{ seatNo: 0, han: 3, fu: 60, dealInSeatNo: 2 }] },
      ENGINE_VERSION,
    );
    assert.equal(off360Dealer.perSeat[0].netPoints, 11600);

    const on360Dealer = calculateSettlement(
      rulesKiriageOn,
      make4pHand(),
      { kind: 'ron', winners: [{ seatNo: 0, han: 3, fu: 60, dealInSeatNo: 2 }] },
      ENGINE_VERSION,
    );
    assert.equal(on360Dealer.perSeat[0].netPoints, 12000);
  });

  it('handles haneman, baiman, sanbaiman, kazoe yakuman, and composite yakuman caps', () => {
    const tiers: Array<{ han: number; yakumanCount?: number; koRon: number; oyaRon: number }> = [
      { han: 6, koRon: 12000, oyaRon: 18000 },
      { han: 7, koRon: 12000, oyaRon: 18000 },
      { han: 8, koRon: 16000, oyaRon: 24000 },
      { han: 10, koRon: 16000, oyaRon: 24000 },
      { han: 11, koRon: 24000, oyaRon: 36000 },
      { han: 12, koRon: 24000, oyaRon: 36000 },
      { han: 13, koRon: 32000, oyaRon: 48000 },
      { han: 13, yakumanCount: 2, koRon: 64000, oyaRon: 96000 },
    ];

    for (const t of tiers) {
      const ko = calculateSettlement(
        rules4p,
        make4pHand(),
        { kind: 'ron', winners: [{ seatNo: 1, han: t.han, fu: 30, yakumanCount: t.yakumanCount, dealInSeatNo: 2 }] },
        ENGINE_VERSION,
      );
      assert.equal(ko.perSeat[1].netPoints, t.koRon);

      const oya = calculateSettlement(
        rules4p,
        make4pHand(),
        { kind: 'ron', winners: [{ seatNo: 0, han: t.han, fu: 30, yakumanCount: t.yakumanCount, dealInSeatNo: 2 }] },
        ENGINE_VERSION,
      );
      assert.equal(oya.perSeat[0].netPoints, t.oyaRon);
    }

    // Kazoe yakuman disabled => 13 han caps at sanbaiman (24,000)
    const noKazoe = calculateSettlement(
      makeRules({ ...HOUSE_4P_V1, kazoeYakuman: false }),
      make4pHand(),
      { kind: 'ron', winners: [{ seatNo: 1, han: 13, fu: 30, dealInSeatNo: 2 }] },
      ENGINE_VERSION,
    );
    assert.equal(noKazoe.perSeat[1].netPoints, 24000);
  });

  it('computes 3-player tsumo-loss payments per §4.2 and §12.1', () => {
    const rules3p = makeRules({ ...HOUSE_3P_V1 });

    // Non-dealer mangan tsumo in 3p: dealer pays 4000, other non-dealer pays 2000, winner gets 6000 (§12.1)
    const koMangan = calculateSettlement(
      rules3p,
      make3pHand(),
      { kind: 'tsumo', winners: [{ seatNo: 1, han: 5, fu: 30 }] },
      ENGINE_VERSION,
    );
    assert.equal(koMangan.perSeat[0].netPoints, -4000);
    assert.equal(koMangan.perSeat[2].netPoints, -2000);
    assert.equal(koMangan.perSeat[1].netPoints, 6000);
    assertZeroSumWithPool(koMangan, 0);

    // Dealer mangan tsumo in 3p: each non-dealer pays 4000, winner gets 8000 (§12.1)
    const oyaMangan = calculateSettlement(
      rules3p,
      make3pHand(),
      { kind: 'tsumo', winners: [{ seatNo: 0, han: 5, fu: 30 }] },
      ENGINE_VERSION,
    );
    assert.equal(oyaMangan.perSeat[0].netPoints, 8000);
    assert.equal(oyaMangan.perSeat[1].netPoints, -4000);
    assert.equal(oyaMangan.perSeat[2].netPoints, -4000);
    assertZeroSumWithPool(oyaMangan, 0);
  });
});

describe('Honba, Riichi in/out in one event, and Multi-Ron', () => {
  const rules4p = makeRules({ ...HOUSE_4P_V1 });
  const rules3p = makeRules({ ...HOUSE_3P_V1 });

  it('handles §12.1 sample: non-dealer 3 han 40 fu ron with 2 honba and 2 carried-over riichi sticks', () => {
    const hand = make4pHand({ honba: 2, riichiPool: 2000 });
    const out = calculateSettlement(
      rules4p,
      hand,
      { kind: 'ron', winners: [{ seatNo: 1, han: 3, fu: 40, dealInSeatNo: 2 }] },
      ENGINE_VERSION,
    );
    // Deal-in pays 5200 + 600 = 5800; winner gets 5800 + 2000 = 7800; pool -> 0
    assert.equal(out.perSeat[2].netPoints, -5800);
    assert.equal(out.perSeat[1].netPoints, 7800);
    assert.equal(out.nextHand.riichiPool, 0);
    assertZeroSumWithPool(out, 2000);
  });

  it('handles 3p 1 honba tsumo (+100 per payer, +200 total) and 1 honba ron (+200) per §4.2 & §12.1', () => {
    const tsumoOut = calculateSettlement(
      rules3p,
      make3pHand({ honba: 1 }),
      { kind: 'tsumo', winners: [{ seatNo: 1, han: 5, fu: 30 }] },
      ENGINE_VERSION,
    );
    assert.equal(tsumoOut.perSeat[0].netPoints, -4100);
    assert.equal(tsumoOut.perSeat[2].netPoints, -2100);
    assert.equal(tsumoOut.perSeat[1].netPoints, 6200);
    assertZeroSumWithPool(tsumoOut, 0);

    const ronOut = calculateSettlement(
      rules3p,
      make3pHand({ honba: 1 }),
      { kind: 'ron', winners: [{ seatNo: 1, han: 5, fu: 30, dealInSeatNo: 2 }] },
      ENGINE_VERSION,
    );
    assert.equal(ronOut.perSeat[2].netPoints, -8200);
    assert.equal(ronOut.perSeat[1].netPoints, 8200);
    assertZeroSumWithPool(ronOut, 0);
  });

  it('reproduces docs/数据库设计.md §6.3 ledger example: A riichi, B rons 3900 off C in one settlement event', () => {
    // Seat 0 = A (riichi), Seat 1 = B (winner, 3 han 30 fu = 3900), Seat 2 = C (deal-in)
    const hand = make4pHand({
      seats: [
        { seatNo: 0, points: 25000, isRiichi: true, isTenpai: null },
        { seatNo: 1, points: 25000, isRiichi: false, isTenpai: null },
        { seatNo: 2, points: 25000, isRiichi: false, isTenpai: null },
        { seatNo: 3, points: 25000, isRiichi: false, isTenpai: null },
      ],
    });
    const out = calculateSettlement(
      rules4p,
      hand,
      { kind: 'ron', winners: [{ seatNo: 1, han: 3, fu: 30, dealInSeatNo: 2 }] },
      ENGINE_VERSION,
    );
    assert.equal(out.perSeat[0].netPoints, -1000);
    assert.equal(out.perSeat[1].netPoints, 4900); // +3900 ron + 1000 riichi pool
    assert.equal(out.perSeat[2].netPoints, -3900);
    assert.equal(out.perSeat[3].netPoints, 0);
    assert.equal(out.nextHand.riichiPool, 0);
    assertZeroSumWithPool(out, 0);
  });

  it('does NOT deduct 1000 when the winning tile is the discarder riichi declaration tile (§4.4 & §12.1)', () => {
    // Seat 0 (confirmed riichi earlier) and Seat 2 (declares riichi now, dealt in on declaration tile)
    const hand = make4pHand({
      riichiPool: 1000,
      seats: [
        { seatNo: 0, points: 25000, isRiichi: true, isTenpai: null },
        { seatNo: 1, points: 25000, isRiichi: false, isTenpai: null },
        { seatNo: 2, points: 25000, isRiichi: true, isTenpai: null },
        { seatNo: 3, points: 25000, isRiichi: false, isTenpai: null },
      ],
    });
    const out = calculateSettlement(
      rules4p,
      hand,
      {
        kind: 'ron',
        winners: [{ seatNo: 1, han: 2, fu: 30, dealInSeatNo: 2, isRiichiDeclarationDealIn: true }],
      },
      ENGINE_VERSION,
    );
    // Seat 0 pays -1000 riichi; Seat 2 does NOT pay 1000 riichi, only -2000 ron;
    // Seat 1 gets 2000 ron + 1000 (carried) + 1000 (Seat 0) = 4000.
    assert.equal(out.perSeat[0].netPoints, -1000);
    assert.equal(out.perSeat[2].netPoints, -2000);
    assert.equal(out.perSeat[1].netPoints, 4000);
    assert.equal(out.nextHand.riichiPool, 0);
    assertZeroSumWithPool(out, 1000);
  });

  it('awards riichi pool to nearest winner after deal-in on double ron and charges honba per winner (§4.2)', () => {
    // Deal-in is Seat 2; Winners are Seat 1 (distance 3) and Seat 3 (distance 1 = shimocha of Seat 2)
    // Nearest winner after Seat 2 is Seat 3!
    const hand = make4pHand({
      honba: 1,
      riichiPool: 1000,
      seats: [
        { seatNo: 0, points: 25000, isRiichi: false, isTenpai: null },
        { seatNo: 1, points: 25000, isRiichi: true, isTenpai: null },
        { seatNo: 2, points: 25000, isRiichi: false, isTenpai: null },
        { seatNo: 3, points: 25000, isRiichi: false, isTenpai: null },
      ],
    });
    const out = calculateSettlement(
      rules4p,
      hand,
      {
        kind: 'ron',
        winners: [
          { seatNo: 1, han: 2, fu: 30, dealInSeatNo: 2 }, // 2000 + 300 honba - 1000 riichi = +1300
          { seatNo: 3, han: 3, fu: 30, dealInSeatNo: 2 }, // 3900 + 300 honba + 2000 pool = +6200
        ],
      },
      ENGINE_VERSION,
    );
    assert.equal(out.perSeat[1].netPoints, 1300);
    assert.equal(out.perSeat[3].netPoints, 6200);
    assert.equal(out.perSeat[2].netPoints, -(2000 + 300 + 3900 + 300));
    assertZeroSumWithPool(out, 1000);
  });
});

describe('Ryuukyoku tenpai splits (4p & 3p) and dealer progression', () => {
  it('splits 4p 3000 tenpai pool across 0, 1, 2, 3, 4 tenpai counts and handles dealer repeat/rotation', () => {
    const rules4p = makeRules({ ...HOUSE_4P_V1 });

    // 0 tenpai (all noten): dealer (seat 0) is noten => rotates to seat 1, round E2, honba + 1
    const t0 = calculateSettlement(
      rules4p,
      make4pHand({ honba: 1, riichiPool: 1000 }),
      { kind: 'ryuukyoku', winners: [], tenpai: [false, false, false, false] },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      t0.perSeat.map((s) => s.netPoints),
      [0, 0, 0, 0],
    );
    assert.equal(t0.nextHand.dealerSeatNo, 1);
    assert.equal(t0.nextHand.roundNumber, 2);
    assert.equal(t0.nextHand.honba, 2);
    assert.equal(t0.nextHand.riichiPool, 1000);

    // 1 tenpai (seat 0 dealer): +3000 / -1000 / -1000 / -1000, dealer repeats
    const t1 = calculateSettlement(
      rules4p,
      make4pHand({ honba: 0 }),
      { kind: 'ryuukyoku', winners: [], tenpai: [true, false, false, false] },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      t1.perSeat.map((s) => s.netPoints),
      [3000, -1000, -1000, -1000],
    );
    assert.equal(t1.nextHand.dealerSeatNo, 0);
    assert.equal(t1.nextHand.roundNumber, 1);
    assert.equal(t1.nextHand.honba, 1);
    assertZeroSumWithPool(t1, 0);

    // 2 tenpai: +1500 / +1500 / -1500 / -1500
    const t2 = calculateSettlement(
      rules4p,
      make4pHand(),
      { kind: 'ryuukyoku', winners: [], tenpai: [true, true, false, false] },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      t2.perSeat.map((s) => s.netPoints),
      [1500, 1500, -1500, -1500],
    );
    assertZeroSumWithPool(t2, 0);

    // 3 tenpai: +1000 / +1000 / +1000 / -3000
    const t3 = calculateSettlement(
      rules4p,
      make4pHand(),
      { kind: 'ryuukyoku', winners: [], tenpai: [true, true, true, false] },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      t3.perSeat.map((s) => s.netPoints),
      [1000, 1000, 1000, -3000],
    );
    assertZeroSumWithPool(t3, 0);

    // 4 tenpai: 0 each, dealer repeats
    const t4 = calculateSettlement(
      rules4p,
      make4pHand(),
      { kind: 'ryuukyoku', winners: [], tenpai: [true, true, true, true] },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      t4.perSeat.map((s) => s.netPoints),
      [0, 0, 0, 0],
    );
    assert.equal(t4.nextHand.dealerSeatNo, 0);
    assert.equal(t4.nextHand.honba, 1);
  });

  it('honors a divisible custom 4p noten total across every nontrivial split', () => {
    const rules = makeRules({ ...HOUSE_4P_V1, notenPenaltyTotal: 600 });
    for (const [tenpai, expected] of [
      [[true, false, false, false], [600, -200, -200, -200]],
      [[true, true, false, false], [300, 300, -300, -300]],
      [[true, true, true, false], [200, 200, 200, -600]],
    ] as const) {
      const out = calculateSettlement(rules, make4pHand(),
        { kind: 'ryuukyoku', winners: [], tenpai: [...tenpai] }, ENGINE_VERSION);
      assert.deepEqual(out.perSeat.map((seat) => seat.netPoints), expected);
      assertZeroSumWithPool(out, 0);
    }
  });

  it('splits 3p ryuukyoku for both 3000 template (HOUSE_3P_V1) and 2000 template (COMMON_3P_REF_V1)', () => {
    const rules3p3000 = makeRules({ ...HOUSE_3P_V1 });
    const rules3p2000 = makeRules({ ...COMMON_3P_REF_V1 });

    // 3000 template, 1 tenpai: +3000 / -1500 / -1500
    const r3000_1 = calculateSettlement(
      rules3p3000,
      make3pHand(),
      { kind: 'ryuukyoku', winners: [], tenpai: [true, false, false] },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      r3000_1.perSeat.map((s) => s.netPoints),
      [3000, -1500, -1500],
    );
    assertZeroSumWithPool(r3000_1, 0);

    // 3000 template, 2 tenpai: +1500 / +1500 / -3000
    const r3000_2 = calculateSettlement(
      rules3p3000,
      make3pHand(),
      { kind: 'ryuukyoku', winners: [], tenpai: [true, true, false] },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      r3000_2.perSeat.map((s) => s.netPoints),
      [1500, 1500, -3000],
    );
    assertZeroSumWithPool(r3000_2, 0);

    // 2000 template, 1 tenpai: +2000 / -1000 / -1000
    const r2000_1 = calculateSettlement(
      rules3p2000,
      make3pHand(),
      { kind: 'ryuukyoku', winners: [], tenpai: [false, true, false] },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      r2000_1.perSeat.map((s) => s.netPoints),
      [-1000, 2000, -1000],
    );
    assertZeroSumWithPool(r2000_1, 0);

    // 2000 template, 2 tenpai: +1000 / +1000 / -2000
    const r2000_2 = calculateSettlement(
      rules3p2000,
      make3pHand(),
      { kind: 'ryuukyoku', winners: [], tenpai: [true, true, false] },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      r2000_2.perSeat.map((s) => s.netPoints),
      [1000, 1000, -2000],
    );
    assertZeroSumWithPool(r2000_2, 0);
  });

  it('rotates roundWind from E4 -> S1 -> W1 when non-dealer wins at the end of a wind round', () => {
    const rules4p = makeRules({ ...HOUSE_4P_V1 });
    const e4Hand = make4pHand({
      roundWind: 'E',
      roundNumber: 4,
      dealerSeatNo: 3,
      honba: 2,
    });
    const out = calculateSettlement(
      rules4p,
      e4Hand,
      { kind: 'tsumo', winners: [{ seatNo: 0, han: 2, fu: 30 }] },
      ENGINE_VERSION,
    );
    assert.equal(out.nextHand.roundWind, 'S');
    assert.equal(out.nextHand.roundNumber, 1);
    assert.equal(out.nextHand.dealerSeatNo, 0);
    assert.equal(out.nextHand.honba, 0);
  });
});

describe('Nagashi Mangan and Chombo', () => {
  it('pays nagashi mangan as tsumo mangan and carries over riichi pool by default', () => {
    const rules4p = makeRules({ ...HOUSE_4P_V1, nagashiManganEnabled: true });
    const hand = make4pHand({
      honba: 2,
      riichiPool: 1000,
      seats: [
        { seatNo: 0, points: 25000, isRiichi: true, isTenpai: true },
        { seatNo: 1, points: 25000, isRiichi: false, isTenpai: false },
        { seatNo: 2, points: 25000, isRiichi: false, isTenpai: false },
        { seatNo: 3, points: 25000, isRiichi: false, isTenpai: false },
      ],
    });

    // Non-dealer seat 1 achieves nagashi mangan (+8000: -4000 from dealer 0, -2000 from seats 2 & 3)
    // Seat 0 also pays -1000 riichi stick into pool; pool carries over (1000 + 1000 = 2000)
    const out = calculateSettlement(
      rules4p,
      hand,
      { kind: 'nagashi_mangan', winners: [{ seatNo: 1, han: 5, fu: 30 }],
        nagashiEligibility: [{ seatNo: 1, discards: [{ tile: '1m', called: false }] }] },
      ENGINE_VERSION,
    );
    assert.equal(out.perSeat[0].netPoints, -5000); // -1000 riichi - 4000 nagashi
    assert.equal(out.perSeat[1].netPoints, 8000);
    assert.equal(out.perSeat[2].netPoints, -2000);
    assert.equal(out.perSeat[3].netPoints, -2000);
    assert.equal(out.nextHand.riichiPool, 2000);
    assertZeroSumWithPool(out, 1000);

    // When config.nagashiCollectsRiichiPool is true, winner collects the 2000 pool
    const outCollect = calculateSettlement(
      makeRules({ ...HOUSE_4P_V1, nagashiManganEnabled: true, nagashiCollectsRiichiPool: true }),
      hand,
      { kind: 'nagashi_mangan', winners: [{ seatNo: 1, han: 5, fu: 30 }],
        nagashiEligibility: [{ seatNo: 1, discards: [{ tile: '1m', called: false }] }] },
      ENGINE_VERSION,
    );
    assert.equal(outCollect.perSeat[1].netPoints, 10000);
    assert.equal(outCollect.nextHand.riichiPool, 0);
    assertZeroSumWithPool(outCollect, 1000);
  });

  it('handles P0 chombo void/replay and manual adjudication', () => {
    const rules4p = makeRules({ ...HOUSE_4P_V1 });
    const hand = make4pHand({
      roundWind: 'S',
      roundNumber: 2,
      dealerSeatNo: 1,
      honba: 1,
      riichiPool: 2000,
      seats: [
        { seatNo: 0, points: 25000, isRiichi: true, isTenpai: null },
        { seatNo: 1, points: 25000, isRiichi: false, isTenpai: null },
        { seatNo: 2, points: 25000, isRiichi: false, isTenpai: null },
        { seatNo: 3, points: 25000, isRiichi: false, isTenpai: null },
      ],
    });

    // 1. Void/replay: all zero payments, chombo_replay in breakdown, current riichi NOT deducted, pool preserved
    const replayOut = calculateSettlement(
      rules4p,
      hand,
      { kind: 'chombo', winners: [], chomboRole: { 2: 'offender' } },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      replayOut.perSeat.map((s) => s.netPoints),
      [0, 0, 0, 0],
    );
    assert.equal(replayOut.perSeat[0].breakdown[0].reason, 'chombo_replay');
    assert.equal(replayOut.nextHand.roundWind, 'S');
    assert.equal(replayOut.nextHand.roundNumber, 2);
    assert.equal(replayOut.nextHand.dealerSeatNo, 1);
    assert.equal(replayOut.nextHand.honba, 1);
    assert.equal(replayOut.nextHand.riichiPool, 2000);

    // 2. Manual adjudication: custom zero-sum per-seat netPoints
    const manualOut = calculateSettlement(
      rules4p,
      hand,
      {
        kind: 'chombo',
        winners: [],
        manualPayments: { 0: 4000, 1: 2000, 2: -8000, 3: 2000 },
      },
      ENGINE_VERSION,
    );
    assert.deepEqual(
      manualOut.perSeat.map((s) => s.netPoints),
      [4000, 2000, -8000, 2000],
    );
    assertZeroSumWithPool(manualOut, 2000);
  });
});

describe('Terminal Settlement (calculateTerminalSettlement)', () => {
  it('reproduces the §4.5 doc example: 40000/30000/20000/10000 => +500/+100/-200/-400 tenths (sum 0)', () => {
    const rules = makeRules({ ...HOUSE_4P_V1 });
    const res = calculateTerminalSettlement([40000, 30000, 20000, 10000], rules);
    assert.equal(res.isGameEnd, true);
    assert.deepEqual(res.tenths, [500, 100, -200, -400]);
    assert.deepEqual(
      res.perSeat.map((s) => s.competencyPoints),
      [50, 10, -20, -40],
    );
    assert.equal(
      res.perSeat.reduce((acc, s) => acc + s.totalTenths, 0),
      0,
    );
  });

  it('keeps the pool untouched and awards no final score while the match continues (§4.5 & §12.1)', () => {
    const rules = makeRules({ ...HOUSE_4P_V1 });
    const res = calculateTerminalSettlement(
      [
        { seatNo: 0, points: 21000 },
        { seatNo: 1, points: 29000 },
        { seatNo: 2, points: 29000 },
        { seatNo: 3, points: 19000 },
      ],
      rules,
      { riichiPool: 2000, startingDealerSeatNo: 2, requireTargetPoints: true },
    );
    assert.equal(res.isGameEnd, false);
    assert.equal(res.gameEndReason, 'not_ended');
    assert.equal(res.poolRecipientSeatNo, null);
    assert.equal(res.unclaimedRiichiPoints, 2000);
    assert.deepEqual(res.perSeat.map((s) => s.finalPoints), [21000, 29000, 29000, 19000]);
    assert.deepEqual(res.standings, []);
    assert.deepEqual(res.tenths, []);
  });

  it('handles 3-player terminal settlement with tie-breaking and zero-sum tenths', () => {
    const rules3p = makeRules({ ...HOUSE_3P_V1 });
    // 3 * 35,000 = 105,000 total; Seat 0 and Seat 1 tied at 40,000, Seat 2 at 25,000
    const res = calculateTerminalSettlement([40000, 40000, 25000], rules3p, { startingDealerSeatNo: 1 });
    if (!res.isGameEnd) throw new Error('This terminal case must finish.');
    // Starting dealer is Seat 1 => Seat 1 gets rank 1 (+150 oka + 200 uma + 0 base = +350 tenths)
    // Seat 0 gets rank 2 (0 oka + 0 uma + 0 base = 0 tenths)
    // Seat 2 gets rank 3 (0 oka - 200 uma - 150 base = -350 tenths)
    assert.equal(res.perSeat[1].rank, 1);
    assert.equal(res.perSeat[0].rank, 2);
    assert.equal(res.perSeat[2].rank, 3);
    assert.deepEqual(res.tenths, [0, 350, -350]);
  });
});

describe('Invalid inputs throwing', () => {
  const rules4p = makeRules({ ...HOUSE_4P_V1 });

  it('throws on wrong seat counts or config/handState playerCount mismatch', () => {
    assert.throws(() => {
      calculateSettlement(
        rules4p,
        make3pHand(), // 3 seats passed to 4p config
        { kind: 'tsumo', winners: [{ seatNo: 0, han: 1, fu: 30 }] },
        ENGINE_VERSION,
      );
    }, /Seat count mismatch/);

    assert.throws(() => {
      calculateSettlement(
        makeRules({ playerCount: 5 }),
        make4pHand(),
        { kind: 'tsumo', winners: [{ seatNo: 0, han: 1, fu: 30 }] },
        ENGINE_VERSION,
      );
    }, /Invalid playerCount/);

    assert.throws(() => {
      calculateTerminalSettlement([25000, 25000], rules4p);
    }, /Invalid seat count/);
  });

  it('throws on han < 1, invalid fu, invalid deal-in, or invalid rules config', () => {
    // han < 1
    assert.throws(() => {
      calculateSettlement(
        rules4p,
        make4pHand(),
        { kind: 'ron', winners: [{ seatNo: 1, han: 0, fu: 30, dealInSeatNo: 2 }] },
        ENGINE_VERSION,
      );
    }, /Invalid han/);

    assert.throws(() => {
      calculateSettlement(
        rules4p,
        make4pHand(),
        { kind: 'tsumo', winners: [{ seatNo: 1, han: -2, fu: 30 }] },
        ENGINE_VERSION,
      );
    }, /Invalid han/);

    // fu < 20
    assert.throws(() => {
      calculateSettlement(
        rules4p,
        make4pHand(),
        { kind: 'ron', winners: [{ seatNo: 1, han: 2, fu: 10, dealInSeatNo: 2 }] },
        ENGINE_VERSION,
      );
    }, /Invalid fu/);

    // self deal-in on ron
    assert.throws(() => {
      calculateSettlement(
        rules4p,
        make4pHand(),
        { kind: 'ron', winners: [{ seatNo: 1, han: 2, fu: 30, dealInSeatNo: 1 }] },
        ENGINE_VERSION,
      );
    }, /cannot deal in to themselves/);

    // non-divisible 3p notenPenaltyTotal (§12.1)
    assert.throws(() => {
      calculateSettlement(
        makeRules({ ...HOUSE_3P_V1, notenPenaltyTotal: 2500 }),
        make3pHand(),
        { kind: 'ryuukyoku', winners: [], tenpai: [true, false, false] },
        ENGINE_VERSION,
      );
    }, /notenPenaltyTotal/);

    // inconsistent honba config (§12.1)
    assert.throws(() => {
      calculateSettlement(
        makeRules({ ...HOUSE_4P_V1, honbaRon: 200, honbaPerPayer: 100 }),
        make4pHand(),
        { kind: 'ron', winners: [{ seatNo: 1, han: 1, fu: 30, dealInSeatNo: 2 }] },
        ENGINE_VERSION,
      );
    }, /Inconsistent honba config/);

    // low-point riichi (< 1000 points when allowLowPointRiichi is false)
    assert.throws(() => {
      calculateSettlement(
        rules4p,
        make4pHand({
          seats: [
            { seatNo: 0, points: 900, isRiichi: true, isTenpai: null },
            { seatNo: 1, points: 25000, isRiichi: false, isTenpai: null },
            { seatNo: 2, points: 25000, isRiichi: false, isTenpai: null },
            { seatNo: 3, points: 49100, isRiichi: false, isTenpai: null },
          ],
        }),
        { kind: 'tsumo', winners: [{ seatNo: 1, han: 1, fu: 30 }] },
        ENGINE_VERSION,
      );
    }, /cannot confirm riichi/);
  });
});
