/**
 * Pure settlement engine. MUST stay side-effect free.
 * Docs: docs/日麻三端产品计划书.md §4, §12; docs/数据库设计.md §6, §8.
 *
 * Contract (per review f0cf2ac):
 * calculateSettlement(rulesSnapshot, handState, resultInput, engineVersion)
 *  - used by: rule-editor example preview (fixed handState),
 *             pre-submit payment preview (real handState),
 *             server formal settlement (real handState, re-run in tx).
 *  - returns the same per-seat payment + next-hand structure in all three.
 *  - client MUST NOT re-implement amount formulas.
 */

export interface RulesSnapshot {
  rulesHash: string;
  config: Record<string, unknown>;
}

export interface SeatState {
  seatNo: number;
  points: number;
  isRiichi: boolean;
  isTenpai: boolean | null;
}

export interface HandState {
  handId: string;
  roundWind: 'E' | 'S' | 'W';
  roundNumber: number;
  dealerSeatNo: number;
  honba: number;
  riichiPool: number;
  seats: SeatState[];
  markRevision: bigint;
  resultRevision: bigint;
}

export type HandKind = 'ron' | 'tsumo' | 'ryuukyoku' | 'chombo' | 'nagashi_mangan';

export interface WinnerInput {
  seatNo: number;
  han: number;
  fu: number;
  /** Number of ordinary single yakuman; special doubles use doubleYakumanCount instead. */
  yakumanCount?: number;
  dealInSeatNo?: number | null;
  /** Number of special double yakuman; requires the separate doubleYakuman switch. */
  doubleYakumanCount?: number;
  /**
   * If true, the winning tile on a ron was the discarder's riichi declaration tile.
   * Per docs §4.4 / §12.1, a riichi declaration whose tile is ron'd does NOT stand (no 1,000 deducted).
   * All explicit winner flags on a multi-ron refer to the same discard and must agree.
   */
  isRiichiDeclarationDealIn?: boolean;
}
/** Attested complete river for one nagashi winner. The settlement layer cannot verify
 * completeness against a tile log; callers must attest every discard and called status.
 * Own melds do not disqualify the winner. */
export interface NagashiEligibilityInput {
  seatNo: number;
  discards: { tile: string; called: boolean }[];
}


export interface ResultInput {
  kind: HandKind;
  winners: WinnerInput[];
  /** Required for nagashi_mangan: complete discards of every claimed winner, including called status. */
  nagashiEligibility?: NagashiEligibilityInput[];
  /** per-seat tenpai for ryuukyoku; null when not applicable */
  tenpai?: boolean[] | null;
  chomboRole?: Record<number, 'offender' | 'victim'> | null;
  /**
   * Only valid on ron when this marked seat is the winner's actual discarder;
   * its 1,000-point stick does not stand (§4.4 / §12.1).
   * An explicit false winner flag cannot accompany this declaration seat.
   */
  riichiDeclarationDealInSeatNo?: number | null;
  /**
   * Optional per-seat manual net point deltas for P0 chombo adjudication.
   * Every keyed seat must exist; values must be multiples of 100 and sum to zero (§4.2 / §4.4).
   */
  manualPayments?: Record<number, number> | null;
}

export interface SeatPayment {
  seatNo: number;
  /** net point delta for this hand (includes riichi sticks, honba, pool) */
  netPoints: number;
  breakdown: { reason: string; amount: number }[];
}

export interface NextHandState {
  roundWind: 'E' | 'S' | 'W';
  roundNumber: number;
  dealerSeatNo: number;
  honba: number;
  riichiPool: number;
}

export interface SettlementOutput {
  perSeat: SeatPayment[];
  nextHand: NextHandState;
  /** zero-sum invariant: sum(perSeat.netPoints) must equal 0 (including pool movements) */
}

export interface EngineRulesConfig {
  templateKey?: string;
  playerCount: 3 | 4;
  startingPoints: number;
  returnPoints: number;
  targetPoints: number;
  uma: number[];
  oka: number;
  honbaPerPayer: number;
  honbaRon: number;
  /** Configured draw total, divisible into legal 100-point payments for every tenpai split (§4.2 / §12.1). */
  notenPenaltyTotal: number;
  kiriageMangan: boolean;
  kazoeYakuman: boolean;
  /** Count multiple ordinary single yakuman; disabled caps yakumanCount at one. */
  compositeYakuman: boolean;
  /** Count explicitly identified special doubles via WinnerInput.doubleYakumanCount. */
  doubleYakuman: boolean;
  /** Enable nagashi mangan only for attested, uncalled terminal/honor discard histories. */
  nagashiManganEnabled: boolean;
  /** Nagashi draw continuation follows dealer tenpai instead of the winning seat. */
  nagashiDealerRepeatRequiresTenpai: boolean;
  /** 3p: true = tsumo loss; false = rounded full 4p total split between two payers (§4.2 / §4.3). */
  tsumoLoss: boolean;
  /** Multi-ron policy: 'double_ron' (default house rule: 2 winners allowed, 3 winners abortive draw in 4p) | 'head_bump' | 'allow_all' */
  multiRon: 'double_ron' | 'head_bump' | 'allow_all';
  /** Double-ron honba policy: 'each_winner' (default per §4.2) | 'nearest_only' */
  doubleRonHonbaPolicy: 'each_winner' | 'nearest_only';
  /**
   * Nagashi mangan riichi pool policy (documented choice per Deliverable 1):
   * Default false: riichi pool is NOT collected by the nagashi mangan winner and carries over in nextHand.riichiPool.
   * When true: the nagashi mangan winner (or earliest in turn order if multiple) collects the riichi pool.
   */
  nagashiCollectsRiichiPool: boolean;
  /** Whether negative points (< 0) end the match (0 continues per §4.2) */
  bustEndsGame: boolean;
  /** Whether a seat with < 1,000 points may confirm riichi (default false per §4.4; WRC allows true) */
  allowLowPointRiichi: boolean;
  /** End policy: fixed South 4 requires an explicit completion context, regardless of points. */
  fixedSouth4EndPolicy: 'target_or_bust' | 'completed_south_4';
  /** Allocation of riichi sticks left on table when the match ends. */
  terminalRiichiPoolPolicy: 'first' | 'unallocated';
  /** Split combined uma among seats with tied final points or break ties by starting seat order. */
  tiedUmaPolicy: 'seat_order' | 'split';
  /** Finish ranked sanma automatically after final dealer stop or round cap. */
  automaticEndPolicy: 'manual' | 'ranked_sanma';
}

export const HOUSE_4P_V1: Readonly<EngineRulesConfig> = Object.freeze({
  templateKey: 'house_4p_v1',
  playerCount: 4,
  startingPoints: 25000,
  returnPoints: 30000,
  targetPoints: 30000,
  uma: [20, 10, -10, -20],
  oka: 20,
  honbaPerPayer: 100,
  honbaRon: 300,
  notenPenaltyTotal: 3000,
  kiriageMangan: false,
  kazoeYakuman: true,
  compositeYakuman: true,
  doubleYakuman: false,
  tsumoLoss: false,
  multiRon: 'double_ron',
  doubleRonHonbaPolicy: 'each_winner',
  nagashiCollectsRiichiPool: false,
  nagashiManganEnabled: false,
  nagashiDealerRepeatRequiresTenpai: false,
  bustEndsGame: true,
  allowLowPointRiichi: false,
  fixedSouth4EndPolicy: 'target_or_bust',
  terminalRiichiPoolPolicy: 'first',
  tiedUmaPolicy: 'seat_order',
  automaticEndPolicy: 'manual',
});

export const WRC_4P_REF_V1: Readonly<EngineRulesConfig> = Object.freeze({
  templateKey: 'wrc_4p_ref_v1',
  playerCount: 4,
  startingPoints: 30000,
  returnPoints: 30000,
  targetPoints: 30000,
  uma: [15, 5, -5, -15],
  oka: 0,
  honbaPerPayer: 100,
  honbaRon: 300,
  notenPenaltyTotal: 3000,
  kiriageMangan: true,
  kazoeYakuman: true,
  compositeYakuman: true,
  doubleYakuman: false,
  tsumoLoss: false,
  multiRon: 'head_bump',
  doubleRonHonbaPolicy: 'nearest_only',
  nagashiCollectsRiichiPool: false,
  nagashiManganEnabled: false,
  nagashiDealerRepeatRequiresTenpai: false,
  bustEndsGame: false,
  allowLowPointRiichi: true,
  fixedSouth4EndPolicy: 'completed_south_4',
  terminalRiichiPoolPolicy: 'unallocated',
  tiedUmaPolicy: 'split',
  automaticEndPolicy: 'manual',
});

export const HOUSE_3P_V1: Readonly<EngineRulesConfig> = Object.freeze({
  templateKey: 'house_3p_v1',
  playerCount: 3,
  startingPoints: 35000,
  returnPoints: 40000,
  targetPoints: 40000,
  uma: [20, 0, -20],
  oka: 15,
  honbaPerPayer: 100,
  honbaRon: 200,
  notenPenaltyTotal: 3000,
  kiriageMangan: false,
  kazoeYakuman: true,
  compositeYakuman: true,
  doubleYakuman: false,
  tsumoLoss: true,
  multiRon: 'double_ron',
  doubleRonHonbaPolicy: 'each_winner',
  nagashiCollectsRiichiPool: false,
  nagashiManganEnabled: false,
  nagashiDealerRepeatRequiresTenpai: false,
  bustEndsGame: true,
  allowLowPointRiichi: false,
  fixedSouth4EndPolicy: 'target_or_bust',
  terminalRiichiPoolPolicy: 'first',
  tiedUmaPolicy: 'seat_order',
  automaticEndPolicy: 'manual',
});

export const COMMON_3P_REF_V1: Readonly<EngineRulesConfig> = Object.freeze({
  templateKey: 'common_3p_ref_v1',
  playerCount: 3,
  startingPoints: 35000,
  returnPoints: 40000,
  targetPoints: 40000,
  uma: [20, 0, -20],
  oka: 15,
  honbaPerPayer: 100,
  honbaRon: 200,
  notenPenaltyTotal: 2000,
  kiriageMangan: false,
  kazoeYakuman: true,
  compositeYakuman: true,
  doubleYakuman: false,
  tsumoLoss: true,
  multiRon: 'double_ron',
  doubleRonHonbaPolicy: 'nearest_only',
  nagashiCollectsRiichiPool: false,
  nagashiManganEnabled: true,
  nagashiDealerRepeatRequiresTenpai: true,
  bustEndsGame: true,
  allowLowPointRiichi: false,
  fixedSouth4EndPolicy: 'target_or_bust',
  terminalRiichiPoolPolicy: 'first',
  tiedUmaPolicy: 'seat_order',
  automaticEndPolicy: 'ranked_sanma',
});

export const RULESET_TEMPLATES: Readonly<Record<string, Readonly<EngineRulesConfig>>> = Object.freeze({
  house_4p_v1: HOUSE_4P_V1,
  wrc_4p_ref_v1: WRC_4P_REF_V1,
  house_3p_v1: HOUSE_3P_V1,
  common_3p_ref_v1: COMMON_3P_REF_V1,
});

export const ENGINE_VERSION = '0.1.0';

function roundUp100(points: number): number {
  return Math.ceil(points / 100) * 100;
}

function resolveEffectiveFu(fu: number): number {
  if (!Number.isFinite(fu) || !Number.isInteger(fu) || fu < 20) {
    throw new Error(`Invalid fu: ${fu}. Must be an integer >= 20.`);
  }
  // Per docs §2.2 / §4.3 / §12.1: Chiitoitsu (7 pairs) is fixed at 25 fu and MUST NOT be rounded up to 30.
  if (fu === 25) {
    return 25;
  }
  return Math.ceil(fu / 10) * 10;
}

function calculateBasicPoints(
  han: number,
  fu: number,
  yakumanCount: number | undefined,
  doubleYakumanCount: number | undefined,
  config: EngineRulesConfig,
): number {
  if (!Number.isFinite(han) || !Number.isInteger(han) || han < 1) {
    throw new Error(`Invalid han: ${han}. Must be an integer >= 1.`);
  }
  // Fu does not affect yakuman points, but malformed submitted fu must not bypass validation.
  const effectiveFu = fu === undefined ? undefined : resolveEffectiveFu(fu);
  for (const [name, count] of [['yakumanCount', yakumanCount], ['doubleYakumanCount', doubleYakumanCount]] as const) {
    if (count !== undefined && (!Number.isInteger(count) || count < 0)) {
      throw new Error(`Invalid ${name}: ${count}.`);
    }
  }
  if ((doubleYakumanCount ?? 0) > 0 && !config.doubleYakuman) {
    throw new Error('Special double yakuman is disabled by this ruleset.');
  }
  const multiplier = (config.compositeYakuman ? yakumanCount ?? 0 : Math.min(yakumanCount ?? 0, 1)) +
    2 * (doubleYakumanCount ?? 0);
  if (multiplier > 0) {
    return 8000 * (config.compositeYakuman ? multiplier : Math.min(multiplier, 2));
  }
  if (effectiveFu === undefined) {
    throw new Error('Invalid fu: a non-yakuman hand requires fu.');
  }
  if (han >= 13) {
    return config.kazoeYakuman ? 8000 : 6000;
  }
  if (han >= 11) {
    return 6000; // Sanbaiman
  }
  if (han >= 8) {
    return 4000; // Baiman
  }
  if (han >= 6) {
    return 3000; // Haneman
  }
  if (han === 5) {
    return 2000; // Mangan
  }

  const rawBasic = effectiveFu * Math.pow(2, han + 2);
  if (rawBasic >= 2000) {
    return 2000;
  }
  // Kiriage mangan: 4 han 30 fu (1920) and 3 han 60 fu (1920) round up to mangan (2000) when enabled
  if (config.kiriageMangan && rawBasic === 1920) {
    return 2000;
  }
  return rawBasic;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v;
    }
  }
  return undefined;
}

function pickBoolean(obj: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'boolean') {
      return v;
    }
  }
  return undefined;
}

export function normalizeRulesConfig(
  rawConfig: Record<string, unknown>,
  inferredPlayerCount?: number,
): EngineRulesConfig {
  if (!rawConfig || typeof rawConfig !== 'object') {
    throw new Error('Invalid rulesSnapshot.config: must be an object.');
  }

  const templateKey = typeof rawConfig.templateKey === 'string' ? rawConfig.templateKey : undefined;
  const templateBase = templateKey && RULESET_TEMPLATES[templateKey] ? RULESET_TEMPLATES[templateKey] : undefined;

  const explicitPlayerCount = pickNumber(rawConfig, ['playerCount', 'players', 'numPlayers']);
  if (explicitPlayerCount !== undefined && explicitPlayerCount !== 3 && explicitPlayerCount !== 4) {
    throw new Error(`Invalid playerCount in config: ${explicitPlayerCount}. Expected 3 or 4.`);
  }
  if (
    explicitPlayerCount !== undefined &&
    inferredPlayerCount !== undefined &&
    explicitPlayerCount !== inferredPlayerCount
  ) {
    throw new Error(
      `Seat count mismatch: config specifies ${explicitPlayerCount} players, but received ${inferredPlayerCount} seats.`,
    );
  }
  if (templateBase && (explicitPlayerCount !== undefined && explicitPlayerCount !== templateBase.playerCount ||
    inferredPlayerCount !== undefined && inferredPlayerCount !== templateBase.playerCount)) {
    throw new Error(`Seat count mismatch: template ${templateKey} requires ${templateBase.playerCount} players.`);
  }

  const resolvedCount = explicitPlayerCount ?? templateBase?.playerCount ?? inferredPlayerCount ?? 4;
  if (resolvedCount !== 3 && resolvedCount !== 4) {
    throw new Error(`Invalid player count: ${resolvedCount}. Expected 3 or 4.`);
  }
  const playerCount: 3 | 4 = resolvedCount;
  const base: Readonly<EngineRulesConfig> = templateBase ?? (playerCount === 3 ? HOUSE_3P_V1 : HOUSE_4P_V1);

  const startingPoints =
    pickNumber(rawConfig, ['startingPoints', 'startPoints', 'initialPoints', 'openingBalance']) ?? base.startingPoints;
  const returnPoints =
    pickNumber(rawConfig, ['returnPoints', 'okaBasePoints', 'baseReturnPoints']) ?? base.returnPoints;
  const targetPoints = pickNumber(rawConfig, ['targetPoints', 'goalPoints']) ?? returnPoints;

  if (!Number.isInteger(startingPoints) || startingPoints % 100 !== 0) {
    throw new Error(`Invalid startingPoints: ${startingPoints}. Must be an integer multiple of 100.`);
  }
  if (!Number.isInteger(returnPoints) || returnPoints % 100 !== 0) {
    throw new Error(`Invalid returnPoints: ${returnPoints}. Must be an integer multiple of 100.`);
  }

  let uma: number[] = [...base.uma];
  if (Array.isArray(rawConfig.uma)) {
    if (rawConfig.uma.length !== playerCount || !rawConfig.uma.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error(`Invalid uma array: must have ${playerCount} finite numbers.`);
    }
    uma = (rawConfig.uma as number[]).slice();
  } else if (Array.isArray(rawConfig.umaTenths)) {
    if (
      rawConfig.umaTenths.length !== playerCount ||
      !rawConfig.umaTenths.every((v) => typeof v === 'number' && Number.isInteger(v))
    ) {
      throw new Error(`Invalid umaTenths array: must have ${playerCount} integers.`);
    }
    uma = (rawConfig.umaTenths as number[]).map((t) => t / 10);
  }
  const umaTenthsSum = uma.reduce((acc, v) => acc + Math.round(v * 10), 0);
  if (umaTenthsSum !== 0) {
    throw new Error(`Invalid uma: sum of uma must be 0, got ${umaTenthsSum / 10}.`);
  }

  const computedOka = ((returnPoints - startingPoints) * playerCount) / 1000;
  const explicitOka = pickNumber(rawConfig, ['oka']);
  const explicitOkaTenths = pickNumber(rawConfig, ['okaTenths']);
  if (explicitOka !== undefined && Math.round(explicitOka * 10) !== Math.round(computedOka * 10)) {
    throw new Error(
      `Invalid oka: ${explicitOka} does not match (returnPoints - startingPoints) * playerCount / 1000 = ${computedOka}.`,
    );
  }
  if (explicitOkaTenths !== undefined && explicitOkaTenths !== Math.round(computedOka * 10)) {
    throw new Error(
      `Invalid okaTenths: ${explicitOkaTenths} does not match expected ${Math.round(computedOka * 10)}.`,
    );
  }
  const oka = computedOka;

  // Honba resolution (4p default: 300 ron / 100 per payer; 3p default: 200 ron / 100 per payer)
  const honbaObj =
    typeof rawConfig.honba === 'object' && rawConfig.honba !== null
      ? (rawConfig.honba as Record<string, unknown>)
      : undefined;
  let explicitHonbaPerPayer =
    pickNumber(rawConfig, ['honbaPerPayer', 'honbaTsumoPerPayer', 'tsumoHonbaPerPayer', 'honbaTsumo']) ??
    (honbaObj ? pickNumber(honbaObj, ['perPayer', 'tsumoPerPayer', 'tsumo']) : undefined);
  let explicitHonbaRon =
    pickNumber(rawConfig, ['honbaRon', 'ronHonba', 'honbaTotal', 'honbaPointsRon', 'honbaPoints']) ??
    (honbaObj ? pickNumber(honbaObj, ['ron', 'total']) : undefined) ??
    (typeof rawConfig.honba === 'number' ? rawConfig.honba : undefined);

  const payerCount = playerCount - 1;
  if (explicitHonbaPerPayer !== undefined && explicitHonbaRon !== undefined) {
    if (explicitHonbaRon !== explicitHonbaPerPayer * payerCount) {
      throw new Error(
        `Inconsistent honba config: honbaRon (${explicitHonbaRon}) must equal (playerCount - 1) * honbaPerPayer (${explicitHonbaPerPayer * payerCount}).`,
      );
    }
  } else if (explicitHonbaPerPayer !== undefined) {
    explicitHonbaRon = explicitHonbaPerPayer * payerCount;
  } else if (explicitHonbaRon !== undefined) {
    if (explicitHonbaRon % payerCount !== 0) {
      throw new Error(
        `Invalid honbaRon (${explicitHonbaRon}) for ${playerCount} players: not divisible by ${payerCount} payers.`,
      );
    }
    explicitHonbaPerPayer = explicitHonbaRon / payerCount;
  }

  const honbaPerPayer = explicitHonbaPerPayer ?? base.honbaPerPayer;
  const honbaRon = explicitHonbaRon ?? base.honbaRon;
  if (!Number.isInteger(honbaPerPayer) || honbaPerPayer < 0 || honbaPerPayer % 100 !== 0) {
    throw new Error(`Invalid honbaPerPayer: ${honbaPerPayer}. Must be a non-negative multiple of 100.`);
  }

  // Ryuukyoku noten penalty total (4p default: 3000, may be 2000; 3p default: 3000 in house_3p_v1, 2000 in common_3p_ref_v1)
  const notenPenaltyTotal =
    pickNumber(rawConfig, [
      'notenPenaltyTotal',
      'ryuukyokuPenaltyTotal',
      'tenpaiPenaltyTotal',
      'ryuukyokuPoolTotal',
      'notenTotal',
      'ryuukyokuTotal',
      'tenpaiTotal',
    ]) ?? base.notenPenaltyTotal;
  if (!Number.isInteger(notenPenaltyTotal) || notenPenaltyTotal < 0 || notenPenaltyTotal % 100 !== 0) {
    throw new Error(`Invalid notenPenaltyTotal: ${notenPenaltyTotal}. Must be a non-negative multiple of 100.`);
  }
  // Every possible tenpai/noten split must conserve the configured total in 100-point units.
  const unit = playerCount === 3 ? 200 : 600; // 4p needs both 1/3 and 2/2 splits.
  if (notenPenaltyTotal % unit !== 0) {
    throw new Error(`Invalid ${playerCount}p notenPenaltyTotal: ${notenPenaltyTotal} must be divisible by ${unit}.`);
  }

  const kiriageMangan = pickBoolean(rawConfig, ['kiriageMangan', 'kiriage']) ?? base.kiriageMangan;
  const kazoeYakuman = pickBoolean(rawConfig, ['kazoeYakuman']) ?? base.kazoeYakuman;
  const compositeYakuman = pickBoolean(rawConfig, ['compositeYakuman']) ?? base.compositeYakuman;
  const doubleYakuman = pickBoolean(rawConfig, ['doubleYakuman']) ?? base.doubleYakuman;
  const nagashiManganEnabled = pickBoolean(rawConfig, ['nagashiManganEnabled']) ?? base.nagashiManganEnabled;
  const nagashiDealerRepeatRequiresTenpai =
    pickBoolean(rawConfig, ['nagashiDealerRepeatRequiresTenpai']) ?? base.nagashiDealerRepeatRequiresTenpai;

  let tsumoLoss = pickBoolean(rawConfig, ['tsumoLoss']) ?? base.tsumoLoss;
  if (typeof rawConfig.tsumoPaymentMode === 'string') {
    tsumoLoss = rawConfig.tsumoPaymentMode === 'tsumo_loss';
  }

  let multiRon: 'double_ron' | 'head_bump' | 'allow_all' = base.multiRon;
  if (
    rawConfig.multiRon === 'double_ron' ||
    rawConfig.multiRon === 'head_bump' ||
    rawConfig.multiRon === 'allow_all'
  ) {
    multiRon = rawConfig.multiRon;
  } else if (rawConfig.headBump === true || rawConfig.doubleRon === false) {
    multiRon = 'head_bump';
  } else if (rawConfig.tripleRon === 'allow' || rawConfig.tripleRon === true) {
    multiRon = 'allow_all';
  }

  let doubleRonHonbaPolicy: 'each_winner' | 'nearest_only' = base.doubleRonHonbaPolicy;
  if (rawConfig.doubleRonHonbaPolicy === 'each_winner' || rawConfig.doubleRonHonbaPolicy === 'nearest_only') {
    doubleRonHonbaPolicy = rawConfig.doubleRonHonbaPolicy;
  }

  const nagashiCollectsRiichiPool =
    pickBoolean(rawConfig, ['nagashiCollectsRiichiPool', 'nagashiTakesPool']) ?? base.nagashiCollectsRiichiPool;
  const bustEndsGame = pickBoolean(rawConfig, ['bustEndsGame', 'tobiEndsGame']) ?? base.bustEndsGame;
  const allowLowPointRiichi = pickBoolean(rawConfig, ['allowLowPointRiichi']) ?? base.allowLowPointRiichi;
  const fixedSouth4EndPolicy =
    rawConfig.fixedSouth4EndPolicy === 'completed_south_4' || rawConfig.fixedSouth4EndPolicy === 'target_or_bust'
      ? rawConfig.fixedSouth4EndPolicy : base.fixedSouth4EndPolicy;
  const terminalRiichiPoolPolicy =
    rawConfig.terminalRiichiPoolPolicy === 'unallocated' || rawConfig.terminalRiichiPoolPolicy === 'first'
      ? rawConfig.terminalRiichiPoolPolicy : base.terminalRiichiPoolPolicy;
  const tiedUmaPolicy =
    rawConfig.tiedUmaPolicy === 'split' || rawConfig.tiedUmaPolicy === 'seat_order'
      ? rawConfig.tiedUmaPolicy : base.tiedUmaPolicy;
  const automaticEndPolicy =
    rawConfig.automaticEndPolicy === 'ranked_sanma' || rawConfig.automaticEndPolicy === 'manual'
      ? rawConfig.automaticEndPolicy : base.automaticEndPolicy;

  return {
    templateKey: templateKey ?? base.templateKey,
    playerCount,
    startingPoints,
    returnPoints,
    targetPoints,
    uma,
    oka,
    honbaPerPayer,
    honbaRon,
    notenPenaltyTotal,
    kiriageMangan,
    kazoeYakuman,
    compositeYakuman,
    doubleYakuman,
    nagashiManganEnabled,
    nagashiDealerRepeatRequiresTenpai,
    tsumoLoss,
    multiRon,
    doubleRonHonbaPolicy,
    nagashiCollectsRiichiPool,
    bustEndsGame,
    allowLowPointRiichi,
    fixedSouth4EndPolicy,
    terminalRiichiPoolPolicy,
    tiedUmaPolicy,
    automaticEndPolicy,
  };
}

/** End decision after an already-settled hand; manual/house rules never auto-finish. */
export function isAutomaticMatchEnd(
  rawConfig: Record<string, unknown>,
  handState: HandState,
  resultInput: ResultInput,
  nextHand: NextHandState,
  pointsAfter: readonly { seatNo: number; points: number }[],
): boolean {
  const config = normalizeRulesConfig(rawConfig, handState.seats.length);
  if (config.automaticEndPolicy !== 'ranked_sanma') return false;
  if (pointsAfter.length !== config.playerCount ||
    pointsAfter.some((seat) => !handState.seats.some((s) => s.seatNo === seat.seatNo))) {
    throw new Error('Automatic match end requires all settled seat balances.');
  }
  if (config.bustEndsGame && pointsAfter.some((seat) => seat.points < 0)) return true;
  // The ranked-sanma cap is West 3, even when that dealer would repeat.
  if (handState.roundWind === 'W' && handState.roundNumber === 3) return true;
  if (handState.roundWind !== 'S' || handState.roundNumber !== 3) return false;

  let leader = pointsAfter[0];
  for (let i = 1; i < pointsAfter.length; i++) {
    const seat = pointsAfter[i];
    if (seat.points > leader.points || (seat.points === leader.points && seat.seatNo < leader.seatNo)) {
      leader = seat;
    }
  }
  const dealerWon = (resultInput.kind === 'ron' || resultInput.kind === 'tsumo') &&
    resultInput.winners.some((winner) => winner.seatNo === handState.dealerSeatNo);
  const dealerTenpai = (resultInput.kind === 'ryuukyoku' || resultInput.kind === 'nagashi_mangan') &&
    resolveTenpaiMap(handState, resultInput, config.playerCount).get(handState.dealerSeatNo) === true;
  if ((dealerWon || dealerTenpai) && leader.seatNo === handState.dealerSeatNo &&
    leader.points >= config.startingPoints) return true;
  // The ranked-sanma sudden-death threshold is not stated in the cited manual.
  // targetPoints=40,000 is this product's candidate, not an asserted Tenhou value.
  return nextHand.roundWind === 'W' && nextHand.roundNumber === 1 &&
    leader.points >= config.targetPoints;
}

const WIND_ORDER: readonly ('E' | 'S' | 'W')[] = ['E', 'S', 'W'];

function advanceDealerAndRound(
  handState: HandState,
  seatOrder: number[],
  dealerRepeats: boolean,
  nextHonba: number,
  nextRiichiPool: number,
): NextHandState {
  const playerCount = seatOrder.length;
  if (dealerRepeats) {
    return {
      roundWind: handState.roundWind,
      roundNumber: handState.roundNumber,
      dealerSeatNo: handState.dealerSeatNo,
      honba: nextHonba,
      riichiPool: nextRiichiPool,
    };
  }

  const dealerIdx = seatOrder.indexOf(handState.dealerSeatNo);
  const nextDealerSeatNo = seatOrder[(dealerIdx + 1) % playerCount];
  let nextRoundNumber = handState.roundNumber + 1;
  let nextRoundWind: 'E' | 'S' | 'W' = handState.roundWind;

  if (nextRoundNumber > playerCount) {
    nextRoundNumber = 1;
    const windIdx = WIND_ORDER.indexOf(handState.roundWind);
    nextRoundWind = WIND_ORDER[(windIdx + 1) % WIND_ORDER.length];
  }

  return {
    roundWind: nextRoundWind,
    roundNumber: nextRoundNumber,
    dealerSeatNo: nextDealerSeatNo,
    honba: nextHonba,
    riichiPool: nextRiichiPool,
  };
}

function computeTsumoPaymentsForWinner(
  winnerSeatNo: number,
  basicPoints: number,
  dealerSeatNo: number,
  seatOrder: number[],
  config: EngineRulesConfig,
): Map<number, number> {
  const payments = new Map<number, number>();
  const isDealerWinner = winnerSeatNo === dealerSeatNo;
  const nonWinners = seatOrder.filter((s) => s !== winnerSeatNo);

  if (config.playerCount === 4 || config.tsumoLoss) {
    // Standard 4p split, OR 3p with tsumo-loss (自摸损, default per §4.2):
    // Dealer winner: each other player pays R100(2B).
    // Non-dealer winner: dealer pays R100(2B), each other non-dealer pays R100(B).
    for (const payerSeatNo of nonWinners) {
      if (isDealerWinner || payerSeatNo === dealerSeatNo) {
        payments.set(payerSeatNo, roundUp100(2 * basicPoints));
      } else {
        payments.set(payerSeatNo, roundUp100(basicPoints));
      }
    }
  } else {
    // 3p without tsumo-loss (full 4p total compensated by the 2 payers):
    if (isDealerWinner) {
      // Compute the fourth-player total after rounding each of the three original payers.
      const total4p = 3 * roundUp100(2 * basicPoints);
      const firstShare = roundUp100(total4p / 2);
      payments.set(nonWinners[0], firstShare);
      payments.set(nonWinners[1], total4p - firstShare);
    } else {
      const total4p = roundUp100(2 * basicPoints) + 2 * roundUp100(basicPoints);
      const nonDealerShare = roundUp100(total4p / 3);
      const dealerShare = total4p - nonDealerShare;
      for (const payerSeatNo of nonWinners) {
        payments.set(payerSeatNo, payerSeatNo === dealerSeatNo ? dealerShare : nonDealerShare);
      }
    }
  }
  return payments;
}

export function calculateSettlement(
  rulesSnapshot: RulesSnapshot,
  handState: HandState,
  resultInput: ResultInput,
  engineVersion: string,
): SettlementOutput {
  if (!engineVersion || typeof engineVersion !== 'string') {
    throw new Error('Invalid engineVersion: must be a non-empty string.');
  }
  if (!rulesSnapshot || typeof rulesSnapshot !== 'object') {
    throw new Error('Invalid rulesSnapshot.');
  }
  if (!handState || !Array.isArray(handState.seats)) {
    throw new Error('Invalid handState: seats array is required.');
  }
  if (!resultInput || typeof resultInput !== 'object') {
    throw new Error('Invalid resultInput.');
  }

  const seatCount = handState.seats.length;
  if (seatCount !== 3 && seatCount !== 4) {
    throw new Error(`Invalid seat count: ${seatCount}. Expected 3 or 4 seats.`);
  }

  const config = normalizeRulesConfig(rulesSnapshot.config, seatCount);
  const playerCount = config.playerCount;

  // Validate seats, dealer, honba, riichiPool, round
  const seatMap = new Map<number, SeatState>();
  for (const s of handState.seats) {
    if (!Number.isInteger(s.seatNo) || s.seatNo < 0) {
      throw new Error(`Invalid seatNo: ${s.seatNo}.`);
    }
    if (seatMap.has(s.seatNo)) {
      throw new Error(`Duplicate seatNo: ${s.seatNo}.`);
    }
    if (!Number.isFinite(s.points) || !Number.isInteger(s.points)) {
      throw new Error(`Invalid points for seat ${s.seatNo}: ${s.points}.`);
    }
    seatMap.set(s.seatNo, s);
  }

  const seatOrder = [...handState.seats].map((s) => s.seatNo).sort((a, b) => a - b);
  if (!seatMap.has(handState.dealerSeatNo)) {
    throw new Error(`dealerSeatNo ${handState.dealerSeatNo} is not in handState.seats.`);
  }
  if (!Number.isInteger(handState.honba) || handState.honba < 0) {
    throw new Error(`Invalid honba: ${handState.honba}.`);
  }
  if (!Number.isInteger(handState.riichiPool) || handState.riichiPool < 0 || handState.riichiPool % 1000 !== 0) {
    throw new Error(`Invalid riichiPool: ${handState.riichiPool}. Must be a non-negative multiple of 1000.`);
  }
  if (!WIND_ORDER.includes(handState.roundWind)) {
    throw new Error(`Invalid roundWind: ${String(handState.roundWind)}.`);
  }
  if (!Number.isInteger(handState.roundNumber) || handState.roundNumber < 1 || handState.roundNumber > playerCount) {
    throw new Error(`Invalid roundNumber: ${handState.roundNumber} for ${playerCount} players.`);
  }

  // Initialize per-seat payment tracking in original handState.seats order
  const breakdowns = new Map<number, { reason: string; amount: number }[]>();
  const netMap = new Map<number, number>();
  for (const s of handState.seats) {
    breakdowns.set(s.seatNo, []);
    netMap.set(s.seatNo, 0);
  }
  const addEntry = (seatNo: number, reason: string, amount: number): void => {
    breakdowns.get(seatNo)!.push({ reason, amount });
    netMap.set(seatNo, netMap.get(seatNo)! + amount);
  };

  const kind = resultInput.kind;
  const declarationSeatNo = resultInput.riichiDeclarationDealInSeatNo;
  const hasDeclarationSeat = declarationSeatNo !== undefined && declarationSeatNo !== null;
  let winnerDeclaresDealIn = false;
  let winnerDeniesDealIn = false;
  if (Array.isArray(resultInput.winners)) {
    for (const w of resultInput.winners) {
      if (w.isRiichiDeclarationDealIn !== undefined && typeof w.isRiichiDeclarationDealIn !== 'boolean') {
        throw new Error('isRiichiDeclarationDealIn must be a boolean.');
      }
      winnerDeclaresDealIn ||= w.isRiichiDeclarationDealIn === true;
      winnerDeniesDealIn ||= w.isRiichiDeclarationDealIn === false;
    }
  }
  if (winnerDeniesDealIn && (hasDeclarationSeat || winnerDeclaresDealIn)) {
    throw new Error('Conflicting riichi declaration deal-in flags for the same ron discard.');
  }
  if (hasDeclarationSeat && (kind !== 'ron' || !Array.isArray(resultInput.winners) ||
    !seatMap.get(declarationSeatNo)?.isRiichi ||
    !resultInput.winners.some((w) => w.dealInSeatNo === declarationSeatNo && w.seatNo !== declarationSeatNo))) {
    throw new Error('riichiDeclarationDealInSeatNo must be a marked seat that dealt in on a ron.');
  }
  if (winnerDeclaresDealIn && (kind !== 'ron' || !Array.isArray(resultInput.winners) ||
    !resultInput.winners.every((w) => w.dealInSeatNo !== undefined && w.dealInSeatNo !== null &&
      seatMap.get(w.dealInSeatNo)?.isRiichi))) {
    throw new Error('isRiichiDeclarationDealIn requires a marked ron deal-in seat.');
  }

  // Handle Chombo first (P0: void/replay or manual adjudication)
  if (kind === 'chombo') {
    if (resultInput.manualPayments && Object.keys(resultInput.manualPayments).length > 0) {
      let manualSum = 0;
      for (const [key, delta] of Object.entries(resultInput.manualPayments)) {
        const seatNo = Number(key);
        if (!Number.isInteger(seatNo) || String(seatNo) !== key || !seatMap.has(seatNo)) {
          throw new Error(`Invalid manual payment seat: ${key}.`);
        }
        if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta % 100 !== 0) {
          throw new Error(`Invalid manual payment for seat ${seatNo}: ${delta}. Must be a multiple of 100.`);
        }
        manualSum += delta;
        addEntry(seatNo, 'manual_adjudication', delta);
      }
      if (manualSum !== 0) {
        throw new Error(`Invalid chombo manualPayments: sum must be 0, got ${manualSum}.`);
      }
    } else {
      for (const s of handState.seats) {
        addEntry(s.seatNo, 'chombo_replay', 0);
      }
    }

    const perSeat: SeatPayment[] = handState.seats.map((s) => ({
      seatNo: s.seatNo,
      netPoints: netMap.get(s.seatNo)!,
      breakdown: breakdowns.get(s.seatNo)!,
    }));

    return {
      perSeat,
      nextHand: {
        roundWind: handState.roundWind,
        roundNumber: handState.roundNumber,
        dealerSeatNo: handState.dealerSeatNo,
        honba: handState.honba,
        riichiPool: handState.riichiPool,
      },
    };
  }

  // Determine which seats have a voided riichi due to deal-in on their riichi declaration tile (§4.4 / §12.1)
  const voidedRiichiSeats = new Set<number>();
  if (declarationSeatNo !== undefined && declarationSeatNo !== null) {
    voidedRiichiSeats.add(declarationSeatNo);
  }
  if (kind === 'ron' && Array.isArray(resultInput.winners)) {
    for (const w of resultInput.winners) {
      if (w.isRiichiDeclarationDealIn && w.dealInSeatNo !== undefined && w.dealInSeatNo !== null) {
        voidedRiichiSeats.add(w.dealInSeatNo);
      }
    }
  }

  // Deduct 1,000 from each seat whose riichi stands in this settlement event (§4.4 / §6.3)
  let newRiichiSticksPoints = 0;
  for (const s of handState.seats) {
    if (s.isRiichi && !voidedRiichiSeats.has(s.seatNo)) {
      if (!config.allowLowPointRiichi && s.points < 1000) {
        throw new Error(`Seat ${s.seatNo} has ${s.points} points (< 1000) and cannot confirm riichi.`);
      }
      addEntry(s.seatNo, 'riichi', -1000);
      newRiichiSticksPoints += 1000;
    }
  }
  const totalPoolAvailable = handState.riichiPool + newRiichiSticksPoints;

  if (kind === 'ron') {
    if (!Array.isArray(resultInput.winners) || resultInput.winners.length < 1) {
      throw new Error('Ron requires at least one winner.');
    }
    if (resultInput.winners.length >= playerCount) {
      throw new Error(`Invalid number of ron winners (${resultInput.winners.length}) for ${playerCount} players.`);
    }

    const seenWinners = new Set<number>();
    let dealInSeatNo: number | null = null;
    for (const w of resultInput.winners) {
      if (!seatMap.has(w.seatNo)) {
        throw new Error(`Invalid winner seatNo: ${w.seatNo}.`);
      }
      if (seenWinners.has(w.seatNo)) {
        throw new Error(`Duplicate winner seatNo: ${w.seatNo}.`);
      }
      seenWinners.add(w.seatNo);
      if (w.dealInSeatNo === undefined || w.dealInSeatNo === null || !seatMap.has(w.dealInSeatNo)) {
        throw new Error(`Ron winner ${w.seatNo} must specify a valid dealInSeatNo.`);
      }
      if (w.dealInSeatNo === w.seatNo) {
        throw new Error(`Winner ${w.seatNo} cannot deal in to themselves.`);
      }
      if (dealInSeatNo === null) {
        dealInSeatNo = w.dealInSeatNo;
      } else if (dealInSeatNo !== w.dealInSeatNo) {
        throw new Error(`All winners in a multi-ron must share the same dealInSeatNo.`);
      }
      // Validate all submitted winners, even when house triple ron becomes an abortive draw.
      calculateBasicPoints(w.han, w.fu, w.yakumanCount, w.doubleYakumanCount, config);
    }

    // 4p Triple Ron abortive draw per §4.2 ("三家荣和按途中流局") and §4.4 ("模板允许的途中流局: 连庄, +1, 保留")
    if (playerCount === 4 && resultInput.winners.length === 3 && config.multiRon === 'double_ron') {
      const perSeat: SeatPayment[] = handState.seats.map((s) => ({
        seatNo: s.seatNo,
        netPoints: netMap.get(s.seatNo)!,
        breakdown: breakdowns.get(s.seatNo)!,
      }));
      const nextHand = advanceDealerAndRound(
        handState,
        seatOrder,
        true,
        handState.honba + 1,
        totalPoolAvailable,
      );
      assertZeroSum(perSeat, handState.riichiPool, nextHand.riichiPool);
      return { perSeat, nextHand };
    }

    // Order winners by turn order distance after dealInSeatNo (1 = shimocha, 2 = toimen, 3 = kamicha)
    const dealInIdx = seatOrder.indexOf(dealInSeatNo!);
    const sortedWinners = [...resultInput.winners].sort((a, b) => {
      const distA = (seatOrder.indexOf(a.seatNo) - dealInIdx + playerCount) % playerCount;
      const distB = (seatOrder.indexOf(b.seatNo) - dealInIdx + playerCount) % playerCount;
      return distA - distB;
    });

    // If multiRon === 'head_bump', only the closest winner in turn order after dealInSeatNo wins
    const activeWinners = config.multiRon === 'head_bump' ? [sortedWinners[0]] : sortedWinners;
    const nearestWinnerSeatNo = activeWinners[0].seatNo;

    for (const w of activeWinners) {
      const basicPoints = calculateBasicPoints(w.han, w.fu, w.yakumanCount, w.doubleYakumanCount, config);
      const isDealerWinner = w.seatNo === handState.dealerSeatNo;
      const handPoints = roundUp100((isDealerWinner ? 6 : 4) * basicPoints);

      addEntry(dealInSeatNo!, 'ron_payment', -handPoints);
      addEntry(w.seatNo, 'ron_win', handPoints);

      const getsHonba =
        handState.honba > 0 &&
        (config.doubleRonHonbaPolicy === 'each_winner' || w.seatNo === nearestWinnerSeatNo);
      if (getsHonba) {
        const honbaBonus = handState.honba * config.honbaRon;
        addEntry(dealInSeatNo!, 'honba_payment', -honbaBonus);
        addEntry(w.seatNo, 'honba_win', honbaBonus);
      }

      if (w.seatNo === nearestWinnerSeatNo && totalPoolAvailable > 0) {
        addEntry(w.seatNo, 'riichi_pool', totalPoolAvailable);
      }
    }

    const dealerWon = activeWinners.some((w) => w.seatNo === handState.dealerSeatNo);
    const nextHonba = dealerWon ? handState.honba + 1 : 0;
    const nextHand = advanceDealerAndRound(handState, seatOrder, dealerWon, nextHonba, 0);
    const perSeat: SeatPayment[] = handState.seats.map((s) => ({
      seatNo: s.seatNo,
      netPoints: netMap.get(s.seatNo)!,
      breakdown: breakdowns.get(s.seatNo)!,
    }));
    assertZeroSum(perSeat, handState.riichiPool, nextHand.riichiPool);
    return { perSeat, nextHand };
  }

  if (kind === 'tsumo') {
    if (!Array.isArray(resultInput.winners) || resultInput.winners.length !== 1) {
      throw new Error('Tsumo requires exactly one winner.');
    }
    const w = resultInput.winners[0];
    if (!seatMap.has(w.seatNo)) {
      throw new Error(`Invalid tsumo winner seatNo: ${w.seatNo}.`);
    }
    if (w.dealInSeatNo !== undefined && w.dealInSeatNo !== null) {
      throw new Error('Tsumo winner must not have a dealInSeatNo.');
    }

    const basicPoints = calculateBasicPoints(w.han, w.fu, w.yakumanCount, w.doubleYakumanCount, config);
    const basePayments = computeTsumoPaymentsForWinner(
      w.seatNo,
      basicPoints,
      handState.dealerSeatNo,
      seatOrder,
      config,
    );

    let totalWinPoints = 0;
    let totalHonbaPoints = 0;
    const perPayerHonba = handState.honba * config.honbaPerPayer;

    for (const [payerSeatNo, baseAmount] of basePayments.entries()) {
      addEntry(payerSeatNo, 'tsumo_payment', -baseAmount);
      totalWinPoints += baseAmount;
      if (perPayerHonba > 0) {
        addEntry(payerSeatNo, 'honba_payment', -perPayerHonba);
        totalHonbaPoints += perPayerHonba;
      }
    }

    addEntry(w.seatNo, 'tsumo_win', totalWinPoints);
    if (totalHonbaPoints > 0) {
      addEntry(w.seatNo, 'honba_win', totalHonbaPoints);
    }
    if (totalPoolAvailable > 0) {
      addEntry(w.seatNo, 'riichi_pool', totalPoolAvailable);
    }

    const dealerWon = w.seatNo === handState.dealerSeatNo;
    const nextHonba = dealerWon ? handState.honba + 1 : 0;
    const nextHand = advanceDealerAndRound(handState, seatOrder, dealerWon, nextHonba, 0);
    const perSeat: SeatPayment[] = handState.seats.map((s) => ({
      seatNo: s.seatNo,
      netPoints: netMap.get(s.seatNo)!,
      breakdown: breakdowns.get(s.seatNo)!,
    }));
    assertZeroSum(perSeat, handState.riichiPool, nextHand.riichiPool);
    return { perSeat, nextHand };
  }

  if (kind === 'ryuukyoku') {
    if (Array.isArray(resultInput.winners) && resultInput.winners.length > 0) {
      throw new Error('Ryuukyoku must not have winners.');
    }
    const tenpaiMap = resolveTenpaiMap(handState, resultInput, playerCount);
    for (const s of handState.seats) {
      if (s.isRiichi && !tenpaiMap.get(s.seatNo)) {
        throw new Error(`Riichi seat ${s.seatNo} is noten: manual adjudication required.`);
      }
    }
    const tenpaiSeats = seatOrder.filter((s) => tenpaiMap.get(s) === true);
    const notenSeats = seatOrder.filter((s) => !tenpaiMap.get(s));
    const tenpaiCount = tenpaiSeats.length;
    const notenCount = notenSeats.length;

    if (tenpaiCount > 0 && tenpaiCount < playerCount && config.notenPenaltyTotal > 0) {
      const totalPenalty = config.notenPenaltyTotal;
      const receivePerTenpai = totalPenalty / tenpaiCount;
      const payPerNoten = totalPenalty / notenCount;

      for (const s of tenpaiSeats) {
        addEntry(s, 'tenpai_receipt', receivePerTenpai);
      }
      for (const s of notenSeats) {
        addEntry(s, 'noten_penalty', -payPerNoten);
      }
    }

    const dealerTenpai = tenpaiMap.get(handState.dealerSeatNo) === true;
    // Per §4.4: On ryuukyoku, honba ALWAYS increments by +1 even when dealer is noten and rotates
    const nextHand = advanceDealerAndRound(
      handState,
      seatOrder,
      dealerTenpai,
      handState.honba + 1,
      totalPoolAvailable,
    );
    const perSeat: SeatPayment[] = handState.seats.map((s) => ({
      seatNo: s.seatNo,
      netPoints: netMap.get(s.seatNo)!,
      breakdown: breakdowns.get(s.seatNo)!,
    }));
    assertZeroSum(perSeat, handState.riichiPool, nextHand.riichiPool);
    return { perSeat, nextHand };
  }

  if (kind === 'nagashi_mangan') {
    if (!config.nagashiManganEnabled) {
      throw new Error('Automatic nagashi mangan is disabled: manual adjudication required.');
    }
    if (!Array.isArray(resultInput.winners) || resultInput.winners.length < 1) {
      throw new Error('Nagashi mangan requires at least one winner.');
    }
    const seenWinners = new Set<number>();
    for (const w of resultInput.winners) {
      if (!seatMap.has(w.seatNo)) {
        throw new Error(`Invalid nagashi_mangan winner seatNo: ${w.seatNo}.`);
      }
      if (seenWinners.has(w.seatNo)) {
        throw new Error(`Duplicate nagashi_mangan winner seatNo: ${w.seatNo}.`);
      }
      seenWinners.add(w.seatNo);
    }
    if (!Array.isArray(resultInput.nagashiEligibility) ||
      resultInput.nagashiEligibility.length !== seenWinners.size) {
      throw new Error('Nagashi mangan requires a complete discard history for every claimed winner.');
    }
    const seenHistories = new Set<number>();
    for (const history of resultInput.nagashiEligibility) {
      if (!history || !seenWinners.has(history.seatNo) || seenHistories.has(history.seatNo) ||
        !Array.isArray(history.discards) || history.discards.length === 0) {
        throw new Error('Invalid nagashi mangan winner discard history.');
      }
      seenHistories.add(history.seatNo);
      for (const discard of history.discards) {
        if (!discard || typeof discard.tile !== 'string' ||
          !/^(?:[1-9][mps]|[1-7]z)$/.test(discard.tile) ||
          typeof discard.called !== 'boolean' ||
          discard.called || !(/^[19][mps]$/.test(discard.tile) || /^[1-7]z$/.test(discard.tile))) {
          throw new Error(`Nagashi mangan seat ${history.seatNo} has a called or non-terminal/honor discard.`);
        }
      }
    }
    const tenpaiMap = resolveTenpaiMap(handState, resultInput, playerCount);
    for (const s of handState.seats) {
      if (s.isRiichi && !tenpaiMap.get(s.seatNo)) {
        throw new Error(`Riichi seat ${s.seatNo} is noten: manual adjudication required.`);
      }
    }

    // Nagashi mangan pays as tsumo mangan (basicPoints = 2000), without honba bonus.
    // Riichi pool policy (Deliverable 1): by default (config.nagashiCollectsRiichiPool === false),
    // the riichi pool is NOT collected by the nagashi winner and carries over in nextHand.riichiPool.
    for (const w of resultInput.winners) {
      const payments = computeTsumoPaymentsForWinner(
        w.seatNo,
        2000,
        handState.dealerSeatNo,
        seatOrder,
        config,
      );
      let totalNagashiWin = 0;
      for (const [payerSeatNo, amount] of payments.entries()) {
        addEntry(payerSeatNo, 'nagashi_mangan_payment', -amount);
        totalNagashiWin += amount;
      }
      addEntry(w.seatNo, 'nagashi_mangan_win', totalNagashiWin);
    }

    let nextRiichiPool = totalPoolAvailable;
    if (config.nagashiCollectsRiichiPool && totalPoolAvailable > 0) {
      const firstWinnerSeatNo = resultInput.winners[0].seatNo;
      addEntry(firstWinnerSeatNo, 'riichi_pool', totalPoolAvailable);
      nextRiichiPool = 0;
    }

    const dealerWonNagashi = seenWinners.has(handState.dealerSeatNo);
    const dealerTenpai = tenpaiMap.get(handState.dealerSeatNo) === true;
    const dealerRepeats = config.nagashiDealerRepeatRequiresTenpai ? dealerTenpai : dealerWonNagashi || dealerTenpai;
    const nextHand = advanceDealerAndRound(
      handState,
      seatOrder,
      dealerRepeats,
      handState.honba + 1,
      nextRiichiPool,
    );
    const perSeat: SeatPayment[] = handState.seats.map((s) => ({
      seatNo: s.seatNo,
      netPoints: netMap.get(s.seatNo)!,
      breakdown: breakdowns.get(s.seatNo)!,
    }));
    assertZeroSum(perSeat, handState.riichiPool, nextHand.riichiPool);
    return { perSeat, nextHand };
  }

  throw new Error(`Unsupported hand kind: ${String(kind)}`);
}

function resolveTenpaiMap(
  handState: HandState,
  resultInput: ResultInput,
  playerCount: number,
): Map<number, boolean> {
  const map = new Map<number, boolean>();
  if (resultInput.tenpai !== undefined && resultInput.tenpai !== null) {
    if (!Array.isArray(resultInput.tenpai) || resultInput.tenpai.length !== playerCount) {
      throw new Error(`Invalid resultInput.tenpai: expected array of length ${playerCount}.`);
    }
    for (let i = 0; i < playerCount; i++) {
      const val = resultInput.tenpai[i];
      if (typeof val !== 'boolean') {
        throw new Error(`Invalid tenpai value at index ${i}: expected boolean.`);
      }
      map.set(handState.seats[i].seatNo, val);
    }
    return map;
  }

  for (const s of handState.seats) {
    map.set(s.seatNo, s.isTenpai === true);
  }
  return map;
}


function assertZeroSum(perSeat: SeatPayment[], riichiPoolBefore: number, riichiPoolAfter: number): void {
  const seatSum = perSeat.reduce((acc, s) => acc + s.netPoints, 0);
  const poolDelta = riichiPoolAfter - riichiPoolBefore;
  if (seatSum + poolDelta !== 0) {
    throw new Error(
      `Zero-sum invariant violated: sum(perSeat.netPoints)=${seatSum}, poolDelta=${poolDelta}.`,
    );
  }
}

export type TerminalPointsInput =
  | readonly number[]
  | readonly { seatNo: number; points: number }[]
  | {
      seats?: readonly ({ seatNo: number; points: number } | number)[];
      points?: readonly number[];
      riichiPool?: number;
      unclaimedRiichiPoints?: number;
      startingDealerSeatNo?: number;
      requireTargetPoints?: boolean;
      completedSouth4?: boolean;
    };

export interface TerminalSettlementOptions {
  /** Unclaimed riichi pool sticks remaining on the table at game end (in points, multiple of 1000) */
  riichiPool?: number;
  /** Starting dealer seat number for tie-breaking (default: lowest seatNo in seats) */
  startingDealerSeatNo?: number;
  /** If true, game end requires max(rawPoints) >= targetPoints (excluding pool) unless someone busted */
  requireTargetPoints?: boolean;
  /** Attested completed South 4 dealer rotation; required for fixed-South-4 end policy. */
  completedSouth4?: boolean;
}

export interface TerminalSeatResult {
  seatNo: number;
  /** Seat points before unclaimed riichi pool transfer */
  rawPoints: number;
  /** Seat points after any terminal pool transfer (unchanged for an unallocated pool). */
  finalPoints: number;
  /** Final 1-based rank; tied seats share rank when tiedUmaPolicy is split. */
  rank: number;
  /** (finalPoints - returnPoints) / 100 in integer tenths */
  baseTenths: number;
  /** Uma in integer tenths (e.g. +200 for +20) */
  umaTenths: number;
  /** Oka in integer tenths awarded to #1 (e.g. +200 for +20, 0 for others) */
  okaTenths: number;
  /** Penalty in integer tenths (0 in P0) */
  penaltyTenths: number;
  /** Total competency score in integer tenths: baseTenths + umaTenths + okaTenths - penaltyTenths */
  totalTenths: number;
  /** Total competency score in decimal points (totalTenths / 10) */
  competencyPoints: number;
}

export type TerminalSettlementOutput =
  | {
      isGameEnd: false;
      gameEndReason: 'not_ended';
      /** Pool remains on the table; no seat receives it yet. */
      unclaimedRiichiPoints: number;
      poolRecipientSeatNo: null;
      perSeat: { seatNo: number; rawPoints: number; finalPoints: number }[];
      standings: [];
      tenths: [];
    }
  | {
      isGameEnd: true;
      gameEndReason: 'bust' | 'target_reached' | 'final_round_complete';
      /** Outstanding sticks on table, even when no seat receives them. */
      unclaimedRiichiPoints: number;
      poolRecipientSeatNo: number | null;
      perSeat: TerminalSeatResult[];
      standings: TerminalSeatResult[];
      tenths: number[];
    };

export function calculateTerminalSettlement(
  finalPoints: TerminalPointsInput,
  rules: RulesSnapshot | Record<string, unknown>,
  options?: TerminalSettlementOptions,
): TerminalSettlementOutput {
  if (!finalPoints || typeof finalPoints !== 'object') {
    throw new Error('Invalid finalPoints input.');
  }
  if (!rules || typeof rules !== 'object') {
    throw new Error('Invalid rules input.');
  }

  const rawConfig: Record<string, unknown> =
    'config' in rules && typeof (rules as RulesSnapshot).config === 'object' && (rules as RulesSnapshot).config !== null
      ? (rules as RulesSnapshot).config
      : (rules as Record<string, unknown>);

  // Extract seat points and options from finalPoints + rawConfig + options
  let seatEntries: { seatNo: number; points: number }[];
  let inlinePool: number | undefined;
  let inlineStartDealer: number | undefined;
  let inlineRequireTarget: boolean | undefined;
  let inlineCompletedSouth4: boolean | undefined;

  if (Array.isArray(finalPoints)) {
    seatEntries = finalPoints.map((item, idx) => {
      if (typeof item === 'number') {
        return { seatNo: idx, points: item };
      }
      if (item && typeof item === 'object' && typeof item.seatNo === 'number' && typeof item.points === 'number') {
        return { seatNo: item.seatNo, points: item.points };
      }
      throw new Error(`Invalid finalPoints entry at index ${idx}.`);
    });
  } else {
    const obj = finalPoints as {
      seats?: readonly ({ seatNo: number; points: number } | number)[];
      points?: readonly number[];
      riichiPool?: number;
      unclaimedRiichiPoints?: number;
      startingDealerSeatNo?: number;
      requireTargetPoints?: boolean;
      completedSouth4?: boolean;
    };
    const rawList = obj.seats ?? obj.points;
    if (!Array.isArray(rawList)) {
      throw new Error('Invalid finalPoints: expected array of points/seats.');
    }
    seatEntries = rawList.map((item, idx) => {
      if (typeof item === 'number') {
        return { seatNo: idx, points: item };
      }
      if (item && typeof item === 'object' && typeof item.seatNo === 'number' && typeof item.points === 'number') {
        return { seatNo: item.seatNo, points: item.points };
      }
      throw new Error(`Invalid finalPoints seat entry at index ${idx}.`);
    });
    inlinePool = obj.riichiPool ?? obj.unclaimedRiichiPoints;
    inlineStartDealer = obj.startingDealerSeatNo;
    inlineRequireTarget = obj.requireTargetPoints;
    inlineCompletedSouth4 = obj.completedSouth4;
  }

  if (seatEntries.length !== 3 && seatEntries.length !== 4) {
    throw new Error(`Invalid seat count in calculateTerminalSettlement: ${seatEntries.length}. Expected 3 or 4.`);
  }

  const config = normalizeRulesConfig(rawConfig, seatEntries.length);
  const playerCount = config.playerCount;

  const seenSeats = new Set<number>();
  for (const s of seatEntries) {
    if (!Number.isInteger(s.seatNo) || s.seatNo < 0) {
      throw new Error(`Invalid seatNo: ${s.seatNo}.`);
    }
    if (seenSeats.has(s.seatNo)) {
      throw new Error(`Duplicate seatNo: ${s.seatNo}.`);
    }
    if (!Number.isFinite(s.points) || !Number.isInteger(s.points) || s.points % 100 !== 0) {
      throw new Error(`Invalid points for seat ${s.seatNo}: ${s.points}. Must be an integer multiple of 100.`);
    }
    seenSeats.add(s.seatNo);
  }

  const unclaimedRiichiPoints =
    options?.riichiPool ??
    inlinePool ??
    pickNumber(rawConfig, ['riichiPool', 'unclaimedRiichiPoints']) ??
    0;
  if (!Number.isInteger(unclaimedRiichiPoints) || unclaimedRiichiPoints < 0 || unclaimedRiichiPoints % 1000 !== 0) {
    throw new Error(`Invalid unclaimedRiichiPoints: ${unclaimedRiichiPoints}. Must be a non-negative multiple of 1000.`);
  }

  const seatOrder = [...seatEntries].map((s) => s.seatNo).sort((a, b) => a - b);
  const startingDealerSeatNo =
    options?.startingDealerSeatNo ??
    inlineStartDealer ??
    pickNumber(rawConfig, ['startingDealerSeatNo', 'initialDealerSeatNo']) ??
    seatOrder[0];
  const startDealerIdx = seatOrder.indexOf(startingDealerSeatNo);
  if (startDealerIdx === -1) {
    throw new Error(`Invalid startingDealerSeatNo: ${startingDealerSeatNo}.`);
  }

  // Step 1 (§4.5): Determine game end using ACTUAL points EXCLUDING the unclaimed riichi pool.
  // Note: 0 points continues; < 0 busts when bustEndsGame is enabled.
  const anyBust = config.bustEndsGame && seatEntries.some((s) => s.points < 0);
  const maxActualPoints = Math.max(...seatEntries.map((s) => s.points));
  const requireTargetPoints =
    options?.requireTargetPoints ??
    inlineRequireTarget ??
    pickBoolean(rawConfig, ['requireTargetPoints']) ??
    false;

  const completedSouth4 = options?.completedSouth4 ?? inlineCompletedSouth4;
  if (completedSouth4 !== undefined && typeof completedSouth4 !== 'boolean') {
    throw new Error('completedSouth4 must be a boolean.');
  }
  const gameEndReason = config.fixedSouth4EndPolicy === 'completed_south_4'
    ? completedSouth4 === true ? 'final_round_complete' : 'not_ended'
    : anyBust ? 'bust' :
      maxActualPoints >= config.targetPoints ? 'target_reached' :
        requireTargetPoints ? 'not_ended' : 'final_round_complete';

  // Ledger conservation applies even while the match continues; the pool stays outside seat points.
  const totalPoints = seatEntries.reduce((acc, s) => acc + s.points, unclaimedRiichiPoints);
  const expectedTotalPoints = playerCount * config.startingPoints;
  if (totalPoints !== expectedTotalPoints) {
    throw new Error(
      `Total points conservation violated: sum(points + pool)=${totalPoints}, expected ${expectedTotalPoints} (${playerCount} * ${config.startingPoints}).`,
    );
  }
  if (gameEndReason === 'not_ended') {
    return {
      isGameEnd: false,
      gameEndReason,
      unclaimedRiichiPoints,
      poolRecipientSeatNo: null,
      perSeat: seatEntries.map((s) => ({ seatNo: s.seatNo, rawPoints: s.points, finalPoints: s.points })),
      standings: [],
      tenths: [],
    };
  }

  // Step 2 (§4.5): Rank by actual points (before pool transfer), breaking ties by earliest seat from starting dealer.
  const provisionalSorted = [...seatEntries].sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    const distA = (seatOrder.indexOf(a.seatNo) - startDealerIdx + playerCount) % playerCount;
    const distB = (seatOrder.indexOf(b.seatNo) - startDealerIdx + playerCount) % playerCount;
    return distA - distB;
  });
  const poolRecipientSeatNo = config.terminalRiichiPoolPolicy === 'first' ? provisionalSorted[0].seatNo : null;

  // Transfer remaining pool only when terminal allocation policy awards it to first place.
  const adjustedEntries = seatEntries.map((s) => ({
    seatNo: s.seatNo,
    rawPoints: s.points,
    finalPoints: s.points + (s.seatNo === poolRecipientSeatNo ? unclaimedRiichiPoints : 0),
  }));

  // The pool is transferred only after game end is determined from raw seat points.
  // Final ranking uses pool-adjusted points only when the policy allocates the pool.
  const finalSorted = [...adjustedEntries].sort((a, b) => {
    if (b.finalPoints !== a.finalPoints) {
      return b.finalPoints - a.finalPoints;
    }
    const distA = (seatOrder.indexOf(a.seatNo) - startDealerIdx + playerCount) % playerCount;
    const distB = (seatOrder.indexOf(b.seatNo) - startDealerIdx + playerCount) % playerCount;
    return distA - distB;
  });

  const okaTotalTenths = Math.round(config.oka * 10);
  const resultBySeat = new Map<number, TerminalSeatResult>();
  const standings: TerminalSeatResult[] = [];
  // Divide tied seats' combined uma in integer tenths. Indivisible tenths go to
  // earlier seats in the stable starting-dealer order, retaining exact zero sum.
  const umaByRank = config.uma.map((uma) => Math.round(uma * 10));
  if (config.tiedUmaPolicy === 'split') {
    for (let start = 0; start < playerCount;) {
      let end = start + 1;
      while (end < playerCount && finalSorted[end].finalPoints === finalSorted[start].finalPoints) end++;
      if (end - start > 1) {
        let total = 0;
        for (let i = start; i < end; i++) total += umaByRank[i];
        const share = Math.floor(total / (end - start));
        const remainder = total - share * (end - start);
        for (let i = start; i < end; i++) {
          umaByRank[i] = share + (i - start < remainder ? 1 : 0);
        }
      }
      start = end;
    }
  }
  let sharedRank = 1;

  for (let i = 0; i < finalSorted.length; i++) {
    const entry = finalSorted[i];
    if (i > 0 && entry.finalPoints !== finalSorted[i - 1].finalPoints) sharedRank = i + 1;
    const rank = config.tiedUmaPolicy === 'split' ? sharedRank : i + 1;
    const baseTenths = Math.round((entry.finalPoints - config.returnPoints) / 100);
    const umaTenths = umaByRank[i];
    const okaTenths = i === 0 ? okaTotalTenths : 0;
    const penaltyTenths = 0;
    const totalTenths = baseTenths + umaTenths + okaTenths - penaltyTenths;
    const seatResult: TerminalSeatResult = {
      seatNo: entry.seatNo,
      rawPoints: entry.rawPoints,
      finalPoints: entry.finalPoints,
      rank,
      baseTenths,
      umaTenths,
      okaTenths,
      penaltyTenths,
      totalTenths,
      competencyPoints: totalTenths / 10,
    };
    standings.push(seatResult);
    resultBySeat.set(entry.seatNo, seatResult);
  }

  const sumTenths = standings.reduce((acc, s) => acc + s.totalTenths, 0);
  if (sumTenths + (poolRecipientSeatNo === null ? unclaimedRiichiPoints / 100 : 0) !== 0) {
    throw new Error(`Terminal settlement zero-sum violated: sum(totalTenths)=${sumTenths}.`);
  }

  const perSeat = seatEntries.map((s) => resultBySeat.get(s.seatNo)!);
  return {
    isGameEnd: true,
    gameEndReason,
    unclaimedRiichiPoints,
    poolRecipientSeatNo,
    perSeat,
    standings,
    tenths: perSeat.map((s) => s.totalTenths),
  };
}
