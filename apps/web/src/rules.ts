import { normalizeRulesConfig } from '@riichi/engine';
import type { EngineRulesConfig, HandState, ResultInput, RulesSnapshot } from '@riichi/engine';

export type TableRules = EngineRulesConfig;
export type AdjustableRule = Exclude<keyof EngineRulesConfig, 'templateKey' | 'playerCount' | 'oka'>;
export const adjustableRules: AdjustableRule[] = [
  'startingPoints', 'returnPoints', 'targetPoints', 'uma', 'honbaRon', 'honbaPerPayer',
  'notenPenaltyTotal', 'kiriageMangan', 'multiRon', 'doubleRonHonbaPolicy',
  'nagashiManganEnabled', 'bustEndsGame', 'allowLowPointRiichi', 'terminalRiichiPoolPolicy',
  'tiedUmaPolicy', 'kazoeYakuman', 'doubleYakuman', 'fixedSouth4EndPolicy', 'tsumoLoss',
  'compositeYakuman', 'nagashiCollectsRiichiPool', 'nagashiDealerRepeatRequiresTenpai',
  'automaticEndPolicy',
];
const labels: Record<AdjustableRule, string> = {
  startingPoints: '起始点', returnPoints: '返还点', targetPoints: '终局目标点', uma: '马点',
  honbaRon: '本场荣和总额', honbaPerPayer: '本场自摸每付款者',
  notenPenaltyTotal: '荒牌流局罚符总额', kiriageMangan: '切上满贯', multiRon: '多家荣和',
  doubleRonHonbaPolicy: '双响本场分配', nagashiManganEnabled: '流局满贯',
  bustEndsGame: '飞人结束', allowLowPointRiichi: '低点数立直',
  terminalRiichiPoolPolicy: '终局供托', tiedUmaPolicy: '同点马点分配',
  kazoeYakuman: '累计役满', doubleYakuman: '双倍役满',
  fixedSouth4EndPolicy: '南四局结束条件', tsumoLoss: '三麻自摸损',
  compositeYakuman: '复合役满', nagashiCollectsRiichiPool: '流局满贯收取供托',
  nagashiDealerRepeatRequiresTenpai: '流局满贯庄家听牌连庄',
  automaticEndPolicy: '自动终局',
};
const enumLabels: Record<string, string> = {
  head_bump: '头跳', double_ron: '双响', allow_all: '允许全部和牌',
  nearest_only: '最近胜者', each_winner: '每位胜者',
  first: '首位', unallocated: '不分配', seat_order: '起家座次', split: '均分',
  completed_south_4: '打完南四局', target_or_bust: '目标点或飞人',
  manual: '手动终局', ranked_sanma: '三麻段位自动终局',
};
export const winds = ['东', '南', '西', '北'];
export const pointText = (n: number) => n.toLocaleString('zh-CN');
export function canonicalRules(config: object): TableRules {
  // Normalize legacy aliases once, then retain only keys understood by the engine.
  const clean: Record<string, unknown> = { ...config };
  delete clean.oka;
  delete clean.okaTenths;
  return normalizeRulesConfig(clean);
}
export function ruleOverrides(base: TableRules, adjusted: TableRules): Partial<TableRules> {
  const diff: Partial<TableRules> = {};
  for (const key of adjustableRules) {
    if (JSON.stringify(base[key]) !== JSON.stringify(adjusted[key])) {
      Object.assign(diff, { [key]: key === 'uma' ? [...adjusted.uma] : adjusted[key] });
    }
  }
  return diff;
}
export function matchRulesPayload(versionId: string, base: TableRules, adjusted: TableRules): {
  rulesetVersionId: string; rulesOverride?: Partial<TableRules>;
} {
  const overrides = ruleOverrides(base, adjusted);
  return { rulesetVersionId: versionId,
    ...(Object.keys(overrides).length ? { rulesOverride: overrides } : {}) };
}
export function ruleDescription(key: AdjustableRule, value: TableRules[AdjustableRule]): string {
  const shown = Array.isArray(value) ? value.join(' / ') : typeof value === 'boolean' ? (value ? '开启' : '关闭')
    : typeof value === 'number' ? pointText(value) : enumLabels[value] ?? value;
  return `${labels[key]}：${shown}`;
}
export function ruleSummary(name: string, base: TableRules | null, adjusted: TableRules): { title: string; changes: string[] } {
  const overrides = base ? ruleOverrides(base, adjusted) : {};
  const changes = adjustableRules.filter((key) => key in overrides).map((key) => ruleDescription(key, adjusted[key]));
  return { title: `基于〈${name}〉${changes.length ? `+ 自定义 ${changes.length} 项` : ' · 已按模板'}`, changes };
}
export function snapshotRuleSummary(snapshot: Record<string, unknown> | undefined, fallback: string): { title: string; changes: string[] } {
  const metadata = snapshot?.metadata;
  const details = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
  const templateName = typeof details.baseTemplateName === 'string' ? details.baseTemplateName : fallback;
  if (!snapshot) return { title: `基于〈${templateName}〉`, changes: [] };
  try {
    const current = canonicalRules(snapshot);
    const base = details.baseConfig && typeof details.baseConfig === 'object'
      ? canonicalRules(details.baseConfig as Record<string, unknown>) : null;
    return ruleSummary(templateName, base, current);
  } catch {
    return { title: `基于〈${templateName}〉`, changes: [] };
  }
}
export function rulesSnapshot(rules: TableRules): RulesSnapshot {
  return { rulesHash: 'local-preview', config: { ...rules, uma: [...rules.uma] } };
}
export function initialHand(rules: TableRules, handId = 'preview'): HandState {
  return {
    handId, roundWind: 'E', roundNumber: 1, dealerSeatNo: 0, honba: 0, riichiPool: 0,
    markRevision: 0n, resultRevision: 0n,
    seats: Array.from({ length: rules.playerCount }, (_, seatNo) => ({
      seatNo, points: rules.startingPoints, isRiichi: false, isTenpai: null,
    })),
  };
}
export function exampleResults(rules: TableRules): { title: string; input: ResultInput }[] {
  return [
    { title: '子家 2 番 30 符荣和', input: { kind: 'ron', winners: [{ seatNo: 1, han: 2, fu: 30, dealInSeatNo: 2 }] } },
    { title: '子家 2 番 30 符自摸', input: { kind: 'tsumo', winners: [{ seatNo: 1, han: 2, fu: 30 }] } },
    { title: '荒牌流局 · 一人听牌', input: { kind: 'ryuukyoku', winners: [], tenpai: Array.from({ length: rules.playerCount }, (_, i) => i === 0) } },
    { title: '荒牌流局 · 两人听牌', input: { kind: 'ryuukyoku', winners: [], tenpai: Array.from({ length: rules.playerCount }, (_, i) => i < 2) } },
  ];
}
export function rulesError(rules: TableRules): string | null {
  const points = [rules.startingPoints, rules.returnPoints, rules.targetPoints, rules.notenPenaltyTotal,
    rules.honbaPerPayer, rules.honbaRon];
  if (points.some((n) => !Number.isInteger(n) || n % 100 !== 0) ||
    rules.startingPoints < 1000 || rules.returnPoints <= 0 || rules.targetPoints <= 0 ||
    rules.notenPenaltyTotal < 0 || rules.honbaPerPayer < 0 || rules.honbaRon < 0) {
    return '起始点至少 1,000，返还点和目标点须为正数；其余点数须为非负整百。';
  }
  if (rules.uma.length !== rules.playerCount || rules.uma.some((n) => !Number.isFinite(n) || !Number.isInteger(n * 10)) ||
    Math.round(rules.uma.reduce((sum, n) => sum + n, 0) * 10) !== 0) return '马点需为每座填写十分位数，且总和为零。';
  if (rules.honbaRon !== rules.honbaPerPayer * (rules.playerCount - 1)) return '本场荣和总额需等于自摸每付款者点数乘付款人数。';
  if (rules.notenPenaltyTotal % (rules.playerCount === 3 ? 200 : 600) !== 0) return '流局罚符需能按听牌人数逐笔整百分摊。';
  return null;
}
export function oka(rules: TableRules): number {
  return (rules.returnPoints - rules.startingPoints) * rules.playerCount / 1000;
}
