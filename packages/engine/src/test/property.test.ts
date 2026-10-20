import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  ENGINE_VERSION,
  HOUSE_3P_V1,
  HOUSE_4P_V1,
  COMMON_3P_REF_V1,
  WRC_4P_REF_V1,
  calculateSettlement,
  calculateTerminalSettlement,
  type EngineRulesConfig,
  type HandState,
  type ResultInput,
  type RulesSnapshot,
} from '../index.js';

// Each case gets its own seed, so the reported seed and input reproduce a failure independently.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function integer(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function shuffle<T>(random: () => number, values: T[]): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = integer(random, 0, i);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

const templates = [HOUSE_4P_V1, WRC_4P_REF_V1, HOUSE_3P_V1, COMMON_3P_REF_V1];
const kinds = ['ron', 'tsumo', 'ryuukyoku', 'nagashi_mangan'] as const;
const legalFu = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110] as const;
const winds = ['E', 'S', 'W'] as const;
const HAND_CASES_PER_TEMPLATE = 1200; // 300 of each kind per template
const TERMINAL_CASES_PER_TEMPLATE = 1000;
const HAND_SEED = 0x53b01e42;
const TERMINAL_SEED = 0x71e2a1f0;

function reportCase(seed: number, input: unknown, error: unknown): never {
  throw new Error(`SEED=${seed} (0x${seed.toString(16)}); input=${JSON.stringify(input)}; violation=${String(error)}`);
}

function makeHandCase(config: Readonly<EngineRulesConfig>, random: () => number, iteration: number): {
  hand: HandState;
  result: ResultInput;
  dealerRepeats: boolean;
} {
  const playerCount = config.playerCount;
  const order = shuffle(random, Array.from({ length: playerCount }, (_, i) => i));
  const dealerSeatNo = integer(random, 0, playerCount - 1);
  const kind = kinds[iteration % kinds.length];
  const seats = order.map((seatNo) => {
    const points = integer(random, 0, 600) * 100;
    return {
      seatNo,
      points,
      isRiichi: (config.allowLowPointRiichi || points >= 1000) && random() < 0.5,
      isTenpai: random() < 0.5,
    };
  });
  const hand: HandState = {
    handId: 'property-hand',
    roundWind: winds[integer(random, 0, 1)], // E/S end can advance to S/W; no post-W wraparound match state
    roundNumber: integer(random, 1, playerCount),
    dealerSeatNo,
    honba: integer(random, 0, 4),
    riichiPool: integer(random, 0, 5) * 1000,
    seats,
    markRevision: 0n,
    resultRevision: 0n,
  };
  const winner = (seatNo: number) => ({
    seatNo,
    han: integer(random, 1, 13),
    fu: legalFu[integer(random, 0, legalFu.length - 1)],
  });

  if (kind === 'ron') {
    const dealInSeatNo = integer(random, 0, playerCount - 1);
    const possible = shuffle(random, order.filter((seatNo) => seatNo !== dealInSeatNo));
    // Even head-bump accepts two submitted winners, but only the nearest receives payment.
    const winners = possible.slice(0, integer(random, 1, 2)).map((seatNo) => ({
      ...winner(seatNo), dealInSeatNo,
    }));
    const declarationDealIn = seats.some((s) => s.seatNo === dealInSeatNo && s.isRiichi) && random() < 0.25;
    const result: ResultInput = {
      kind, winners,
      ...(declarationDealIn ? { riichiDeclarationDealInSeatNo: dealInSeatNo } : {}),
    };
    const active = config.multiRon === 'head_bump'
      ? [winners.reduce((nearest, current) =>
        (current.seatNo - dealInSeatNo + playerCount) % playerCount <
        (nearest.seatNo - dealInSeatNo + playerCount) % playerCount ? current : nearest)]
      : winners;
    return { hand, result, dealerRepeats: active.some((w) => w.seatNo === dealerSeatNo) };
  }
  if (kind === 'tsumo') {
    const seatNo = order[integer(random, 0, playerCount - 1)];
    return { hand, result: { kind, winners: [winner(seatNo)] }, dealerRepeats: seatNo === dealerSeatNo };
  }
  const tenpai = seats.map((s) => s.isRiichi || random() < 0.5);
  if (kind === 'ryuukyoku') {
    return { hand, result: { kind, winners: [], tenpai }, dealerRepeats: tenpai[order.indexOf(dealerSeatNo)] };
  }
  const winners = shuffle(random, [...order]).slice(0, integer(random, 1, playerCount)).map(winner);
  return {
    hand,
    result: {
      kind, winners, tenpai,
      nagashiEligibility: winners.map((w) => ({
        seatNo: w.seatNo, discards: [{ tile: '1m', called: false }, { tile: '7z', called: false }],
      })),
    },
    dealerRepeats: config.nagashiDealerRepeatRequiresTenpai
      ? tenpai[order.indexOf(dealerSeatNo)]
      : winners.some((w) => w.seatNo === dealerSeatNo) || tenpai[order.indexOf(dealerSeatNo)],
  };
}

describe('seeded hand settlement properties', () => {
  for (const config of templates) {
    it(`${config.templateKey}: ${HAND_CASES_PER_TEMPLATE} hands (${HAND_CASES_PER_TEMPLATE / 4} per kind), master seed 0x${HAND_SEED.toString(16)}`, () => {
      const master = mulberry32(HAND_SEED ^ config.playerCount ^ templates.indexOf(config));
      const rules: RulesSnapshot = { rulesHash: 'property', config: { ...config, nagashiManganEnabled: true } };
      for (let i = 0; i < HAND_CASES_PER_TEMPLATE; i++) {
        const seed = Math.floor(master() * 0x100000000);
        const { hand, result, dealerRepeats } = makeHandCase(config, mulberry32(seed), i);
        try {
          const out = calculateSettlement(rules, hand, result, ENGINE_VERSION);
          assert.equal(out.perSeat.length, hand.seats.length);
          assert.deepEqual(out.perSeat.map((s) => s.seatNo), hand.seats.map((s) => s.seatNo));
          assert.equal(out.perSeat.reduce((sum, s) => sum + s.netPoints, 0) +
            out.nextHand.riichiPool - hand.riichiPool, 0);
          for (const payment of out.perSeat) {
            assert.ok(Number.isInteger(payment.netPoints) && payment.netPoints % 100 === 0);
            assert.equal(payment.netPoints, payment.breakdown.reduce((sum, entry) => sum + entry.amount, 0));
          }
          const next = out.nextHand;
          assert.equal(next.riichiPool % 1000, 0);
          assert.ok(next.riichiPool >= 0);
          assert.equal(next.dealerSeatNo, dealerRepeats ? hand.dealerSeatNo :
            (hand.dealerSeatNo + 1) % config.playerCount);
          assert.equal(next.honba, result.kind === 'ryuukyoku' || result.kind === 'nagashi_mangan'
            ? hand.honba + 1 : dealerRepeats ? hand.honba + 1 : 0);
          const expectedRound = dealerRepeats ? hand.roundNumber :
            hand.roundNumber === config.playerCount ? 1 : hand.roundNumber + 1;
          const expectedWind = dealerRepeats || hand.roundNumber < config.playerCount
            ? hand.roundWind : winds[winds.indexOf(hand.roundWind) + 1];
          assert.equal(next.roundNumber, expectedRound);
          assert.equal(next.roundWind, expectedWind);
          if (result.kind === 'ron' || result.kind === 'tsumo') {
            const reason = result.kind === 'ron' ? 'ron_win' : 'tsumo_win';
            assert.ok(out.perSeat.some((s) => result.winners.some((w) => w.seatNo === s.seatNo) &&
              s.breakdown.some((entry) => entry.reason === reason && entry.amount > 0)),
            'at least one winner must gain positive hand-payment points, irrespective of riichi/pool');
          }
          if (result.kind === 'ron') {
            const discarder = result.winners[0].dealInSeatNo!;
            if (hand.seats.some((seat) => seat.seatNo === discarder && seat.isRiichi)) {
              const claimed = calculateSettlement(rules, hand, {
                ...result, riichiDeclarationDealInSeatNo: discarder,
              }, ENGINE_VERSION);
              const winnerClaimed = calculateSettlement(rules, hand, {
                kind: 'ron', winners: result.winners.map((w) => ({
                  ...w, isRiichiDeclarationDealIn: true,
                })),
              }, ENGINE_VERSION);
              const ordinary = calculateSettlement(rules, hand, {
                kind: 'ron', winners: result.winners,
              }, ENGINE_VERSION);
              const nearestWinner = [...result.winners].sort((a, b) =>
                (a.seatNo - discarder + config.playerCount) % config.playerCount -
                (b.seatNo - discarder + config.playerCount) % config.playerCount)[0].seatNo;
              assert.deepEqual(claimed, winnerClaimed, 'both declaration inputs must settle identically');
              assert.equal(claimed.nextHand.riichiPool, ordinary.nextHand.riichiPool);
              for (const payment of claimed.perSeat) {
                const regular = ordinary.perSeat.find((seat) => seat.seatNo === payment.seatNo)!;
                const expectedDifference = payment.seatNo === discarder ? 1000 :
                  payment.seatNo === nearestWinner ? -1000 : 0;
                assert.equal(payment.netPoints - regular.netPoints, expectedDifference);
                assert.equal(payment.breakdown.some((entry) => entry.reason === 'riichi'),
                  payment.seatNo !== discarder && hand.seats.some((seat) =>
                    seat.seatNo === payment.seatNo && seat.isRiichi));
              }
            }
          }
        } catch (error) {
          reportCase(seed, { template: config.templateKey, iteration: i, hand: {
            ...hand, markRevision: '0', resultRevision: '0',
          }, result }, error);
        }
      }
    });
  }

  it('permits negative post-hand points on a bust; deltas do not enforce available balance', () => {
    const hand: HandState = {
      handId: 'bust', roundWind: 'E', roundNumber: 1, dealerSeatNo: 0, honba: 0, riichiPool: 0,
      seats: [0, 1, 2, 3].map((seatNo) => ({
        seatNo, points: seatNo === 0 ? 0 : 25000, isRiichi: false, isTenpai: null,
      })),
      markRevision: 0n, resultRevision: 0n,
    };
    const out = calculateSettlement(
      { rulesHash: 'bust', config: { ...HOUSE_4P_V1 } }, hand,
      { kind: 'ron', winners: [{ seatNo: 1, dealInSeatNo: 0, han: 1, fu: 30 }] }, ENGINE_VERSION,
    );
    assert.equal(hand.seats[0].points + out.perSeat[0].netPoints, -1000);
  });
});

function makeTerminalCase(config: Readonly<EngineRulesConfig>, random: () => number, iteration: number) {
  const count = config.playerCount;
  const pool = iteration % 4 === 1 ? 0 : integer(random, 0, 5) * 1000;
  const totalUnits = (count * config.startingPoints - pool) / 100;
  const units: number[] = [];
  if (iteration % 4 === 1) {
    // Exact all-seat tie: pool=0 and starting points are equal.
    for (let i = 0; i < count; i++) units.push(config.startingPoints / 100);
  } else {
    for (let i = 0; i < count - 1; i++) {
      units.push(iteration % 4 === 3 && i === 0 ? -integer(random, 1, 100) :
        integer(random, -100, 600));
    }
    if (iteration % 4 === 0) units[1] = units[0]; // partial ties, including negative ties
    units.push(totalUnits - units.reduce((sum, n) => sum + n, 0));
  }
  const seats = shuffle(random, units.map((n, seatNo) => ({ seatNo, points: n * 100 })));
  return { seats, pool, startingDealerSeatNo: integer(random, 0, count - 1) };
}

describe('seeded terminal settlement properties', () => {
  for (const config of templates) {
    it(`${config.templateKey}: ${TERMINAL_CASES_PER_TEMPLATE} terminals, master seed 0x${TERMINAL_SEED.toString(16)}`, () => {
      const master = mulberry32(TERMINAL_SEED ^ config.playerCount ^ templates.indexOf(config));
      for (let i = 0; i < TERMINAL_CASES_PER_TEMPLATE; i++) {
        const seed = Math.floor(master() * 0x100000000);
        const input = makeTerminalCase(config, mulberry32(seed), i);
        try {
          const out = calculateTerminalSettlement(input.seats, { rulesHash: 'property', config: { ...config } }, {
            riichiPool: input.pool, startingDealerSeatNo: input.startingDealerSeatNo,
            completedSouth4: config.fixedSouth4EndPolicy === 'completed_south_4',
          });
          if (!out.isGameEnd) throw new Error('Default terminal property input should finish the match.');
          const expected = [...input.seats].sort((a, b) => b.points - a.points ||
            (a.seatNo - input.startingDealerSeatNo + config.playerCount) % config.playerCount -
            (b.seatNo - input.startingDealerSeatNo + config.playerCount) % config.playerCount);
          assert.equal(out.poolRecipientSeatNo, config.terminalRiichiPoolPolicy === 'first' ? expected[0].seatNo : null);
          assert.equal(out.unclaimedRiichiPoints, input.pool);
          assert.equal(out.tenths.reduce((sum, n) => sum + n, 0) +
            (config.terminalRiichiPoolPolicy === 'unallocated' ? input.pool / 100 : 0), 0);
          assert.deepEqual(out.tenths, out.perSeat.map((s) => s.totalTenths));
          assert.deepEqual(out.perSeat.map((s) => s.seatNo), input.seats.map((s) => s.seatNo));
          for (const row of out.perSeat) {
            const raw = input.seats.find((s) => s.seatNo === row.seatNo)!.points;
            assert.equal(row.rawPoints, raw);
            assert.equal(row.finalPoints, raw +
              (row.seatNo === out.poolRecipientSeatNo ? input.pool : 0));
          }
          assert.deepEqual(out.standings.map((s) => s.seatNo), expected.map((s) => s.seatNo));
          for (let rank = 0; rank < config.playerCount; rank++) {
            assert.equal(out.standings[rank].rank,
              config.tiedUmaPolicy === 'split'
                ? out.standings.findIndex((s) => s.finalPoints === out.standings[rank].finalPoints) + 1
                : rank + 1);
            if (rank > 0) {
              assert.ok(out.standings[rank - 1].finalPoints >= out.standings[rank].finalPoints);
              assert.ok(out.standings[rank - 1].totalTenths >= out.standings[rank].totalTenths);
            }
          }
          // Strictly larger raw points cannot score fewer tenths; equal points use fixed seat priority.
          for (const a of out.perSeat) for (const b of out.perSeat) {
            if (a.rawPoints > b.rawPoints) assert.ok(a.totalTenths >= b.totalTenths);
          }
        } catch (error) {
          reportCase(seed, { template: config.templateKey, iteration: i, ...input }, error);
        }
      }
    });
  }
});
