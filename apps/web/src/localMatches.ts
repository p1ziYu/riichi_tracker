import { calculateSettlement, calculateTerminalSettlement, ENGINE_VERSION } from '@riichi/engine';
import type { HandState, ResultInput, RulesSnapshot, SettlementOutput, TerminalSettlementOutput } from '@riichi/engine';
import type { TableRules } from './rules';
import { rulesError, rulesSnapshot } from './rules';

const STORAGE_KEY = 'ichihime.localMatches.v1';
const STORAGE_VERSION = 1;

// Exact seed configs and review statuses from 008_seed_system_rulesets.sql. The UI's
// editable TableRules projection follows the same defaults as the rulesets API.
export const LOCAL_SEEDS = [
  { key: 'reference_4p_competition', name: '四麻国际竞技参考', reviewStatus: 'pending', config: {
    playerCount: 4, startingPoints: 30000, returnPoints: 30000, umaTenths: [150, 50, -50, -150], okaTenths: 0, riichiStick: 1000,
    akaDora: { man: 0, pin: 0, sou: 0 }, tsumoPayment: 'standard', ryuukyokuPenaltyTotal: 3000,
    honba: { ronTotal: 300, tsumoPerPayer: 100 }, multipleRon: 'head_bump',
    pendingReview: ['low_point_riichi', 'negative_score_continuation', 'tied_rank_uma_split', 'final_riichi_pool_unallocated', 'competition_penalties'],
  } },
  { key: 'reference_3p_common', name: '三麻常见玩法参考', reviewStatus: 'pending', config: {
    playerCount: 3, startingPoints: 35000, returnPoints: 40000, umaTenths: [200, 0, -200], okaTenths: 150, riichiStick: 1000,
    tsumoPayment: 'tsumo_loss', ryuukyokuPenaltyTotal: 2000, honba: { ronTotal: 200, tsumoPerPayer: 100 },
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
  const c = seed.config;
  const aka = 'akaDora' in c ? c.akaDora : undefined;
  return {
    playerCount: c.playerCount as 3 | 4, startingPoints: c.startingPoints, returnPoints: c.returnPoints,
    uma: c.umaTenths.map((value) => value / 10), ryuukyokuPoolTotal: c.ryuukyokuPenaltyTotal,
    honbaPerPayer: c.honba.tsumoPerPayer, roundLength: 'south', endTarget: c.returnPoints, maxRounds: 12,
    dealerFinish: true, bustEndsMatch: 'bustEndsBelowZero' in c ? c.bustEndsBelowZero : true,
    openTanyao: 'kuitan' in c ? c.kuitan : true,
    redFives: aka ? aka.man + aka.pin + aka.sou : c.playerCount === 3 ? 2 : 3,
    kiriageMangan: 'kiriageMangan' in c ? c.kiriageMangan : false,
    kazoeYakuman: 'kazoeYakuman' in c ? c.kazoeYakuman === 'single_yakuman_at_13_han' : true,
    sanmaTsumoLoss: c.tsumoPayment === 'tsumo_loss',
    doubleRon: !('multipleRon' in c) || c.multipleRon !== 'head_bump',
  };
}

export type LocalHand = Omit<HandState, 'markRevision' | 'resultRevision'> & { markRevision: number; resultRevision: number };
export type LocalResult = { hand: LocalHand; input: ResultInput; output: SettlementOutput; settledAt: string };
export interface LocalMatch {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'finished';
  seedKey: string | null;
  reviewStatus: string | null;
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
function store(): Store {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { version: STORAGE_VERSION, matches: [] };
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || (data as Store).version !== STORAGE_VERSION || !Array.isArray((data as Store).matches)) {
    throw new Error('本地牌局数据版本不兼容；请先备份浏览器数据。');
  }
  return data as Store;
}
function save(matches: LocalMatch[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, matches }));
  window.dispatchEvent(new Event('ichihime:local-matches'));
}
export function listLocalMatches(): LocalMatch[] { return store().matches; }
export function getLocalMatch(id: string): LocalMatch | null { return store().matches.find((match) => match.id === id) ?? null; }
export function isLocalId(id: string | undefined): boolean { return !!id && id.startsWith('local-'); }
export function createLocalMatch(rules: TableRules, name: string, seedKey: string | null = null): LocalMatch {
  const invalid = rulesError(rules);
  if (invalid) throw new Error(invalid);
  const seed = LOCAL_SEEDS.find((item) => item.key === seedKey);
  const createdAt = new Date().toISOString();
  const match: LocalMatch = {
    id: `local-${crypto.randomUUID()}`, name, createdAt, updatedAt: createdAt,
    status: 'active', seedKey, reviewStatus: seed?.reviewStatus ?? null,
    rules: { ...rules, uma: [...rules.uma] },
    rulesSnapshot: {
      rulesHash: 'local-only',
      config: {
        ...rulesSnapshot(rules).config,
        ...(seed ? { templateKey: seed.key } : {}),
        targetPoints: rules.endTarget,
        tsumoLoss: rules.sanmaTsumoLoss,
        bustEndsGame: rules.bustEndsMatch,
        multiRon: rules.doubleRon ? 'double_ron' : 'head_bump',
        honbaRon: rules.honbaPerPayer * (rules.playerCount - 1),
        ...('compositeYakuman' in (seed?.config ?? {}) ? { compositeYakuman: true } : {}),
        ...('doubleYakuman' in (seed?.config ?? {}) ? { doubleYakuman: false } : {}),
      },
    }, engineVersion: ENGINE_VERSION,
    seats: Array.from({ length: rules.playerCount }, (_, seatNo) => ({ seatNo, displayName: `玩家 ${seatNo + 1}` })),
    points: Array(rules.playerCount).fill(rules.startingPoints) as number[], currentHand: null,
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
  const hand: LocalHand = {
    ...match.nextHand, handId: crypto.randomUUID(), markRevision: 0, resultRevision: 0,
    seats: match.seats.map(({ seatNo }) => ({ seatNo, points: match.points[seatNo], isRiichi: false, isTenpai: null })),
  };
  return { ...match, currentHand: hand };
}
export function markLocalRiichi(match: LocalMatch, seatNo: number): LocalMatch {
  const hand = match.currentHand;
  if (match.status !== 'active' || !hand) throw new Error('没有进行中的局');
  const seat = hand.seats.find((entry) => entry.seatNo === seatNo);
  if (!seat || (!seat.isRiichi && seat.points < 1000)) throw new Error('点数不足或座位不存在');
  return { ...match, currentHand: { ...hand, markRevision: hand.markRevision + 1,
    seats: hand.seats.map((entry) => entry.seatNo === seatNo ? { ...entry, isRiichi: !entry.isRiichi } : entry) } };
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
  return { ...match, currentHand: null, nextHand: output.nextHand, points,
    results: [...match.results, { hand, input, output, settledAt: new Date().toISOString() }] };
}
export function finishLocalMatch(match: LocalMatch): LocalMatch {
  if (match.status !== 'active' || match.currentHand) throw new Error('请先结算当前局');
  return { ...match, status: 'finished' };
}
export function previewLocalTerminal(match: LocalMatch): TerminalSettlementOutput {
  if (match.status !== 'finished') throw new Error('请先终局');
  return calculateTerminalSettlement(match.points, match.rulesSnapshot, {
    riichiPool: match.nextHand?.riichiPool ?? 0, startingDealerSeatNo: 0, requireTargetPoints: false,
  });
}
export function confirmLocalTerminal(match: LocalMatch): LocalMatch {
  const terminal = previewLocalTerminal(match);
  if (!terminal.isGameEnd) throw new Error('终局成绩尚未产生');
  return { ...match, terminal, settlementConfirmed: true };
}
