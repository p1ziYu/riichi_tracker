import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  calculateSettlement, calculateTerminalSettlement, normalizeRulesConfig, ENGINE_VERSION, HOUSE_4P_V1,
  type HandState, type RulesSnapshot,
} from '../index.js';

const rules = (config: Record<string, unknown>): RulesSnapshot => ({ rulesHash: 'boundary', config });
const hand = (): HandState => ({
  handId: 'boundary', roundWind: 'E', roundNumber: 1, dealerSeatNo: 0,
  honba: 1, riichiPool: 0, markRevision: 0n, resultRevision: 0n,
  seats: Array.from({ length: 4 }, (_, seatNo) => ({
    seatNo, points: 25000, isRiichi: false, isTenpai: false,
  })),
});

describe('engine config trust and numeric boundaries', () => {
  it('never resolves inherited prototype properties as templates', () => {
    for (const templateKey of ['constructor', '__proto__', 'toString']) {
      const config = normalizeRulesConfig({ templateKey });
      assert.equal(config.startingPoints, HOUSE_4P_V1.startingPoints);
      assert.equal(config.honbaRon, HOUSE_4P_V1.honbaRon);
    }
  });

  it('does not treat malformed supplied numeric fields as omitted defaults', () => {
    for (const override of [
      { startingPoints: '25000' }, { returnPoints: null }, { targetPoints: Infinity },
      { honbaRon: '300' }, { notenPenaltyTotal: false },
      { startingPoints: 'invalid', startPoints: 25000 },
    ]) {
      assert.throws(() => normalizeRulesConfig({ ...HOUSE_4P_V1, ...override }), /Invalid/);
    }
  });

  it('does not silently replace malformed boolean options with house defaults', () => {
    for (const override of [{ bustEndsGame: 'false' }, { doubleYakuman: 1 }, { tsumoLoss: null }]) {
      assert.throws(() => normalizeRulesConfig({ ...HOUSE_4P_V1, ...override }), /Invalid/);
    }
  });

  it('normalizes immutable house-seed kazoe policy without allowing arbitrary strings', () => {
    assert.equal(normalizeRulesConfig({ kazoeYakuman: 'single_yakuman_at_13_han' }).kazoeYakuman, true);
    assert.throws(() => normalizeRulesConfig({ kazoeYakuman: 'disabled' }), /Invalid kazoeYakuman/);
  });

  it('rejects config values too large for stored point and score integers before settlement', () => {
    for (const override of [
      { startingPoints: 2_147_483_700 },
      { returnPoints: 2_147_483_700 },
      { targetPoints: 2_147_483_700 },
      { honbaPerPayer: 2_147_483_700 },
      { honbaRon: 2_147_483_700 },
      { notenPenaltyTotal: 2_147_483_600 },
      { uma: [1e20, -1e20, 0, 0] },
      { umaTenths: [1e20, -1e20, 0, 0], uma: undefined },
    ]) {
      assert.throws(() => normalizeRulesConfig({ ...HOUSE_4P_V1, ...override }), /Invalid|Inconsistent/);
    }
  });

  it('rejects unsafe honba products instead of producing rounded or non-finite deltas', () => {
    const h = hand();
    h.honba = 1_000_000_000;
    const config = { ...HOUSE_4P_V1, honbaPerPayer: 2_000_000_000, honbaRon: 6_000_000_000 };
    // The ron total itself is outside the persisted point domain.
    assert.throws(() => normalizeRulesConfig(config), /Invalid/);
    // Even with individually valid rule amounts, a large hand counter must not overflow a payment.
    const permitted = { ...HOUSE_4P_V1, honbaPerPayer: 700_000_000, honbaRon: 2_100_000_000 };
    assert.throws(() => calculateSettlement(rules(permitted), h, {
      kind: 'ron', winners: [{ seatNo: 1, dealInSeatNo: 2, han: 1, fu: 30 }],
    }, ENGINE_VERSION), /Invalid|safe|overflow/);
  });

  it('rejects terminal score overflow even when each uma entry fits the stored integer', () => {
    assert.throws(() => calculateTerminalSettlement(
      [40000, 20000, 20000, 20000],
      rules({ ...HOUSE_4P_V1, uma: [214_748_360, -214_748_360, 0, 0] }),
    ), /Invalid totalTenths/);
  });
});
