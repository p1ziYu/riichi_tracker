import { calculateSettlement, calculateTerminalSettlement, ENGINE_VERSION, isAutomaticMatchEnd } from '@riichi/engine';
import type { HandState, ResultInput, RulesSnapshot, SettlementOutput, TerminalSettlementOutput } from '@riichi/engine';
import type { TableRules } from './rules';
import { canonicalRules, ruleOverrides, rulesError } from './rules';

export const LOCAL_MATCHES_STORAGE_KEY = 'ichihime.localMatches.v1';
const STORAGE_VERSION = 1;

// Reference configs match 008_seed_system_rulesets.sql; house configs remain as seeded.
export const LOCAL_SEEDS = [
  { key: 'reference_4p_competition', name: '四麻国际竞技参考', reviewStatus: 'pending', config: {
    templateKey: 'wrc_4p_ref_v1', playerCount: 4, startingPoints: 30000, returnPoints: 30000, targetPoints: 30000,
    uma: [15, 5, -5, -15], oka: 0, riichiStick: 1000, akaDora: { man: 0, pin: 0, sou: 0 },
    tsumoLoss: false, notenPenaltyTotal: 3000, honbaRon: 300, honbaPerPayer: 100, multiRon: 'head_bump',
    doubleRonHonbaPolicy: 'nearest_only', kiriageMangan: true, kazoeYakuman: true,
    compositeYakuman: true, doubleYakuman: false, nagashiManganEnabled: false,
    bustEndsGame: false, allowLowPointRiichi: true, terminalRiichiPoolPolicy: 'unallocated',
    tiedUmaPolicy: 'split', fixedSouth4EndPolicy: 'completed_south_4', automaticEndPolicy: 'manual',
    pendingReview: ['competition_penalties'],
  } },
  { key: 'reference_3p_common', name: '三麻常见玩法参考', reviewStatus: 'pending', config: {
    templateKey: 'common_3p_ref_v1', playerCount: 3, startingPoints: 35000, returnPoints: 40000, targetPoints: 40000,
    uma: [20, 0, -20], oka: 15, riichiStick: 1000, tsumoLoss: true, notenPenaltyTotal: 2000,
    honbaRon: 200, honbaPerPayer: 100, multiRon: 'double_ron', doubleRonHonbaPolicy: 'nearest_only',
    kiriageMangan: false, kazoeYakuman: true, compositeYakuman: true, doubleYakuman: false,
    nagashiManganEnabled: true, nagashiDealerRepeatRequiresTenpai: true, nagashiCollectsRiichiPool: false, bustEndsGame: true,
    allowLowPointRiichi: false, terminalRiichiPoolPolicy: 'first', tiedUmaPolicy: 'seat_order',
    fixedSouth4EndPolicy: 'target_or_bust',
    automaticEndPolicy: 'ranked_sanma',
    pendingReview: ['ryuukyoku_penalty_2000_candidate', 'tile_set', 'kita_nukidora', 'dora', 'end_conditions', 'payments'],
  } },
  { key: 'house_4p', name: '四麻家规', reviewStatus: 'reviewed', config: {
    playerCount: 4, startingPoints: 25000, returnPoints: 30000, umaTenths: [200, 100, -100, -200], okaTenths: 200, riichiStick: 1000,
    kuitan: true, akaDora: { man: 1, pin: 1, sou: 1 }, kiriageMangan: false, kazoeYakuman: 'single_yakuman_at_13_han',
    compositeYakuman: true, doubleYakuman: false, doubleWindPair: 'fu_4', tsumoPayment: 'standard',
    honba: { ronTotal: 300, tsumoPerPayer: 100 }, ryuukyokuPenaltyTotal: 3000,
    multipleRon: { double: 'allowed', triple: 'abortive_draw' }, multipleRonPool: 'nearest_winner_after_discarder',
    multipleRonHonba: 'each_winner', bustEndsBelowZero: true, tiebreak: 'initial_seat_order', autoNagashiMangan: false,
    autoPao: false, autoChomboPenalty: false,
  } },
  { key: 'house_3p', name: '三麻家规', reviewStatus: 'reviewed', config: {
    playerCount: 3, startingPoints: 35000, returnPoints: 40000, umaTenths: [200, 0, -200], okaTenths: 150, riichiStick: 1000,
    kuitan: true, akaDora: { man: 0, pin: 1, sou: 1 }, kiriageMangan: false, kazoeYakuman: 'single_yakuman_at_13_han',
    compositeYakuman: true, doubleYakuman: false, doubleWindPair: 'designated_round_and_seat_wind', tsumoPayment: 'tsumo_loss',
    honba: { ronTotal: 200, tsumoPerPayer: 100 }, ryuukyokuPenaltyTotal: 3000, multipleRon: { double: 'allowed' },
    multipleRonPool: 'nearest_winner_after_discarder', multipleRonHonba: 'each_winner', bustEndsBelowZero: true,
    tiebreak: 'initial_seat_order', autoNagashiMangan: false, autoPao: false, autoChomboPenalty: false,
  } },
] as const;

export function seedRules(seed: (typeof LOCAL_SEEDS)[number]): TableRules {
  return canonicalRules(seed.config as unknown as Record<string, unknown>);
}

export type LocalSeat = HandState['seats'][number] & { riichiChangeUsage: { declares: number; cancels: number } };
export type LocalHand = Omit<HandState, 'seats' | 'markRevision' | 'resultRevision'> & {
  seats: LocalSeat[]; markRevision: number; resultRevision: number;
};
export type LocalResult = { hand: LocalHand; input: ResultInput; output: SettlementOutput; settledAt: string };
export interface LocalMatch {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'finished';
  seedKey: string | null;
  reviewStatus: string | null;
  templateName?: string;
  rules: TableRules;
  rulesSnapshot: RulesSnapshot;
  engineVersion: string;
  seats: { seatNo: number; displayName: string }[];
  points: number[];
  currentHand: LocalHand | null;
  nextHand: Pick<LocalHand, 'roundWind' | 'roundNumber' | 'dealerSeatNo' | 'honba' | 'riichiPool'> | null;
  results: LocalResult[];
  terminal: TerminalSettlementOutput | null;
  settlementConfirmed: boolean;
}

type Store = { version: 1; matches: LocalMatch[] };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const seatNumber = (value: unknown, count: number): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < count;
const nextState = (value: unknown, count: number): boolean =>
  record(value) && (value.roundWind === 'E' || value.roundWind === 'S' || value.roundWind === 'W') &&
  Number.isInteger(value.roundNumber) && seatNumber(value.dealerSeatNo, count) &&
  Number.isInteger(value.honba) && (value.honba as number) >= 0 &&
  Number.isInteger(value.riichiPool) && (value.riichiPool as number) >= 0 && (value.riichiPool as number) % 1000 === 0;
const payment = (value: unknown, count: number): boolean =>
  record(value) && seatNumber(value.seatNo, count) && Number.isFinite(value.netPoints) &&
  Array.isArray(value.breakdown) && value.breakdown.every((part: unknown) =>
    record(part) && typeof part.reason === 'string' && Number.isFinite(part.amount));
const validHandSeat = (seat: unknown, index: number): boolean =>
  record(seat) && seat.seatNo === index && Number.isFinite(seat.points) &&
  typeof seat.isRiichi === 'boolean' && (seat.isTenpai === null || typeof seat.isTenpai === 'boolean') &&
  (seat.riichiChangeUsage === undefined || (record(seat.riichiChangeUsage) &&
    typeof seat.riichiChangeUsage.declares === 'number' &&
    Number.isInteger(seat.riichiChangeUsage.declares) && seat.riichiChangeUsage.declares >= 0 &&
    seat.riichiChangeUsage.declares <= 2 &&
    typeof seat.riichiChangeUsage.cancels === 'number' &&
    Number.isInteger(seat.riichiChangeUsage.cancels) && seat.riichiChangeUsage.cancels >= 0 &&
    seat.riichiChangeUsage.cancels <= 1 &&
    seat.riichiChangeUsage.declares - seat.riichiChangeUsage.cancels === (seat.isRiichi ? 1 : 0)));
const restoreHandUsage = (hand: LocalHand): LocalHand => ({
  ...hand, seats: hand.seats.map((seat) => ({
    ...seat, riichiChangeUsage: seat.riichiChangeUsage ??
      { declares: seat.isRiichi ? 1 : 0, cancels: 0 },
  })),
});
function validMatch(value: unknown): value is LocalMatch {
  if (!record(value) || typeof value.id !== 'string' || !value.id.startsWith('local-') ||
    typeof value.name !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' ||
    (value.status !== 'active' && value.status !== 'finished') || !record(value.rules) ||
    !record(value.rulesSnapshot) || !record(value.rulesSnapshot.config) || typeof value.rulesSnapshot.rulesHash !== 'string' ||
    typeof value.engineVersion !== 'string' || !Array.isArray(value.seats) || !Array.isArray(value.points) ||
    !Array.isArray(value.results) || typeof value.settlementConfirmed !== 'boolean') return false;
  const count = value.rules.playerCount;
  if ((count !== 3 && count !== 4) || !Array.isArray(value.rules.uma) ||
    value.rules.uma.length !== count || value.seats.length !== count || value.points.length !== count ||
    !value.points.every(Number.isFinite) ||
    !value.seats.every((seat: unknown, index: number) =>
      record(seat) && seat.seatNo === index && typeof seat.displayName === 'string')) return false;
  const hand = value.currentHand;
  if (hand !== null && (!nextState(hand, count) || !record(hand) || typeof hand.handId !== 'string' ||
    !Number.isInteger(hand.markRevision) || !Number.isInteger(hand.resultRevision) ||
    !Array.isArray(hand.seats) || hand.seats.length !== count ||
    !hand.seats.every(validHandSeat))) return false;
  if (value.nextHand !== null && !nextState(value.nextHand, count)) return false;
  if (value.status === 'active' && value.nextHand === null) return false;
  if (value.status === 'finished' && value.currentHand !== null) return false;
  if (value.terminal !== null && (!record(value.terminal) || typeof value.terminal.isGameEnd !== 'boolean' ||
    !Array.isArray(value.terminal.perSeat) || !value.terminal.perSeat.every((seat: unknown) =>
      record(seat) && seatNumber(seat.seatNo, count) && Number.isFinite(seat.totalTenths) &&
      Number.isFinite(seat.finalPoints) && Number.isInteger(seat.rank)))) return false;
  if (value.settlementConfirmed && (!record(value.terminal) || value.terminal.isGameEnd !== true)) return false;
  return value.results.every((result: unknown) =>
    record(result) && record(result.hand) && typeof result.hand.handId === 'string' &&
    nextState(result.hand, count) && Array.isArray(result.hand.seats) &&
    result.hand.seats.length === count && result.hand.seats.every(validHandSeat) &&
    record(result.input) && typeof result.input.kind === 'string' &&
    record(result.output) && Array.isArray(result.output.perSeat) &&
    result.output.perSeat.length === count && result.output.perSeat.every((seat: unknown) => payment(seat, count)) &&
    typeof result.settledAt === 'string');
}
function store(): Store {
  const raw = localStorage.getItem(LOCAL_MATCHES_STORAGE_KEY);
  if (raw === null) return { version: STORAGE_VERSION, matches: [] };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error('本地牌局数据损坏；请先备份浏览器数据。'); }
  if (!record(data) || data.version !== STORAGE_VERSION || !Array.isArray(data.matches)) {
    throw new Error('本地牌局数据版本不兼容；请先备份浏览器数据。');
  }
  if (!data.matches.every(validMatch)) {
    throw new Error('本地牌局记录不完整；请先备份浏览器数据。');
  }
  return { version: STORAGE_VERSION, matches: (data.matches as LocalMatch[]).map((stored) => {
    const match = { ...stored,
      currentHand: stored.currentHand ? restoreHandUsage(stored.currentHand) : null,
      results: stored.results.map((result) => ({ ...result, hand: restoreHandUsage(result.hand) })),
    };
    // Older v1 records held a lossy UI projection beside the settlement snapshot.
    // Recover its edits while retaining policies that only the snapshot knew.
    if ('ryuukyokuPoolTotal' in match.rules) {
      const legacy = match.rules as unknown as Record<string, unknown>;
      const count = match.rules.playerCount;
      const config = canonicalRules({
        ...match.rulesSnapshot.config, startingPoints: legacy.startingPoints, returnPoints: legacy.returnPoints,
        targetPoints: legacy.endTarget, uma: legacy.uma, notenPenaltyTotal: legacy.ryuukyokuPoolTotal,
        honbaPerPayer: legacy.honbaPerPayer, honbaRon: (legacy.honbaPerPayer as number) * (count - 1),
        kiriageMangan: legacy.kiriageMangan, kazoeYakuman: legacy.kazoeYakuman,
        tsumoLoss: legacy.sanmaTsumoLoss, bustEndsGame: legacy.bustEndsMatch,
        multiRon: legacy.doubleRon ? 'double_ron' : 'head_bump',
      });
      return { ...match, rules: config, rulesSnapshot: { ...match.rulesSnapshot,
        config: { ...config, uma: [...config.uma],
          ...(match.rulesSnapshot.config.metadata ? { metadata: match.rulesSnapshot.config.metadata } : {}) } } };
    }
    return match;
  }) };
}
function save(matches: LocalMatch[]): void {
  localStorage.setItem(LOCAL_MATCHES_STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, matches }));
  window.dispatchEvent(new Event('ichihime:local-matches'));
}
export function listLocalMatches(): LocalMatch[] { return store().matches; }
export function getLocalMatch(id: string): LocalMatch | null { return store().matches.find((match) => match.id === id) ?? null; }
export function isLocalId(id: string | undefined): boolean { return !!id && id.startsWith('local-'); }
export function createLocalMatch(rules: TableRules, name: string, seedKey: string | null = null): LocalMatch {
  const invalid = rulesError(rules);
  if (invalid) throw new Error(invalid);
  const seed = LOCAL_SEEDS.find((item) => item.key === seedKey);
  const baseRules = seed ? seedRules(seed) : null;
  const config = canonicalRules(rules);
  const createdAt = new Date().toISOString();
  const match: LocalMatch = {
    id: `local-${crypto.randomUUID()}`, name, createdAt, updatedAt: createdAt,
    status: 'active', seedKey, reviewStatus: seed?.reviewStatus ?? null, templateName: seed?.name ?? name,
    rules: { ...config, uma: [...config.uma] },
    rulesSnapshot: { rulesHash: 'local-only',
      config: { ...config, uma: [...config.uma],
        ...(seed && baseRules ? { metadata: { baseTemplateName: seed.name, baseConfig: baseRules,
          overrideKeys: Object.keys(ruleOverrides(baseRules, config)) } } : {}),
      },
    }, engineVersion: ENGINE_VERSION,
    seats: Array.from({ length: config.playerCount }, (_, seatNo) => ({ seatNo, displayName: `玩家 ${seatNo + 1}` })),
    points: Array(config.playerCount).fill(config.startingPoints) as number[], currentHand: null,
    nextHand: { roundWind: 'E', roundNumber: 1, dealerSeatNo: 0, honba: 0, riichiPool: 0 },
    results: [], terminal: null, settlementConfirmed: false,
  };
  const ready = openLocalHand(match);
  save([ready, ...store().matches]);
  return ready;
}
export function updateLocalMatch(id: string, change: (match: LocalMatch) => LocalMatch): LocalMatch {
  const matches = store().matches;
  const index = matches.findIndex((match) => match.id === id);
  if (index < 0) throw new Error('本地牌局不存在或已删除');
  const updated = { ...change(matches[index]), id, updatedAt: new Date().toISOString() };
  save(matches.map((match, at) => at === index ? updated : match));
  return updated;
}
export function deleteLocalMatch(id: string): void {
  const matches = store().matches;
  save(matches.filter((match) => match.id !== id));
}
export function openLocalHand(match: LocalMatch): LocalMatch {
  if (match.status !== 'active' || match.currentHand || !match.nextHand) throw new Error('当前不能新开一局');
  if (match.rulesSnapshot.config.fixedSouth4EndPolicy === 'completed_south_4' &&
    match.nextHand.roundWind === 'W' && match.nextHand.roundNumber === 1) {
    throw new Error('固定南四局已结束，请先终局');
  }
  const hand: LocalHand = {
    ...match.nextHand, handId: crypto.randomUUID(), markRevision: 0, resultRevision: 0,
    seats: match.seats.map(({ seatNo }) => ({
      seatNo, points: match.points[seatNo], isRiichi: false, isTenpai: null,
      riichiChangeUsage: { declares: 0, cancels: 0 },
    })),
  };
  return { ...match, currentHand: hand };
}
export function markLocalRiichi(match: LocalMatch, seatNo: number): LocalMatch {
  const hand = match.currentHand;
  if (match.status !== 'active' || !hand) throw new Error('没有进行中的局');
  const seat = hand.seats.find((entry) => entry.seatNo === seatNo);
  if (!seat || (!seat.isRiichi && seat.points < 1000 && match.rulesSnapshot.config.allowLowPointRiichi !== true)) throw new Error('点数不足或座位不存在');
  const usage = seat.riichiChangeUsage ?? { declares: seat.isRiichi ? 1 : 0, cancels: 0 };
  if (seat.isRiichi ? usage.cancels >= 1 : usage.declares >= 2) {
    throw new Error(seat.isRiichi ? '该座位立直取消次数已达上限（最多 1 次）' : '该座位立直声明次数已达上限（最多 2 次）');
  }
  return { ...match, currentHand: { ...hand, markRevision: hand.markRevision + 1,
    seats: hand.seats.map((entry) => entry.seatNo === seatNo ? { ...entry, isRiichi: !entry.isRiichi,
      riichiChangeUsage: { declares: usage.declares + (seat.isRiichi ? 0 : 1),
        cancels: usage.cancels + (seat.isRiichi ? 1 : 0) } } : entry) } };
}
export function previewLocalHand(match: LocalMatch, input: ResultInput): SettlementOutput {
  if (!match.currentHand || match.status !== 'active') throw new Error('没有进行中的局');
  return calculateSettlement(match.rulesSnapshot, {
    ...match.currentHand, markRevision: BigInt(match.currentHand.markRevision), resultRevision: BigInt(match.currentHand.resultRevision),
  }, input, match.engineVersion);
}
export function settleLocalHand(match: LocalMatch, input: ResultInput): LocalMatch {
  const hand = match.currentHand;
  if (!hand) throw new Error('没有进行中的局');
  const output = previewLocalHand(match, input);
  const points = match.points.map((value, seatNo) => value + (output.perSeat.find((seat) => seat.seatNo === seatNo)?.netPoints ?? 0));
  const autoFinished = isAutomaticMatchEnd(match.rulesSnapshot.config, {
    ...hand, markRevision: BigInt(hand.markRevision), resultRevision: BigInt(hand.resultRevision),
  }, input, output.nextHand, points.map((value, seatNo) => ({ seatNo, points: value })));
  return { ...match, status: autoFinished ? 'finished' : match.status, currentHand: null,
    nextHand: output.nextHand, points,
    results: [...match.results, { hand, input, output, settledAt: new Date().toISOString() }] };
}
export function finishLocalMatch(match: LocalMatch): LocalMatch {
  if (match.status !== 'active') throw new Error('牌局已经结束');
  if (match.rulesSnapshot.config.automaticEndPolicy === 'ranked_sanma') {
    throw new Error('段位战结束条件尚未满足，不能手动终局');
  }
  if (match.rulesSnapshot.config.fixedSouth4EndPolicy === 'completed_south_4' &&
    (match.nextHand?.roundWind !== 'W' || match.nextHand.roundNumber !== 1 ||
      !match.results.some(({ hand }) => hand.roundWind === 'S' && hand.roundNumber === 4))) {
    throw new Error('固定南四局尚未结束，不能提前终局');
  }
  if (match.rulesSnapshot.config.fixedSouth4EndPolicy !== 'completed_south_4' &&
    Math.max(...match.points) < Number(match.rulesSnapshot.config.targetPoints) &&
    !(match.rulesSnapshot.config.bustEndsGame === true && match.points.some((points) => points < 0))) {
    throw new Error('尚未达到终局目标点，也没有启用飞人结束的负分座位');
  }
  // Like the server finish endpoint, an open hand is voided, not settled.
  return { ...match, currentHand: null, status: 'finished' };
}
export function previewLocalTerminal(match: LocalMatch): TerminalSettlementOutput {
  if (match.status !== 'finished') throw new Error('请先终局');
  return calculateTerminalSettlement(match.points, match.rulesSnapshot, {
    riichiPool: match.nextHand?.riichiPool ?? 0, startingDealerSeatNo: 0, requireTargetPoints: true,
    completedSouth4: match.rulesSnapshot.config.fixedSouth4EndPolicy === 'completed_south_4' &&
      match.nextHand?.roundWind === 'W' && match.nextHand.roundNumber === 1 &&
      match.results.some(({ hand }) => hand.roundWind === 'S' && hand.roundNumber === 4),
  });
}
export function confirmLocalTerminal(match: LocalMatch): LocalMatch {
  const terminal = previewLocalTerminal(match);
  if (!terminal.isGameEnd) throw new Error('终局成绩尚未产生');
  return { ...match, terminal, settlementConfirmed: true };
}
