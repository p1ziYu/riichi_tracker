import type { HandState, ResultInput, RulesSnapshot } from '@riichi/engine';

export type PlayerCount = 3 | 4;
export interface TableRules {
  playerCount: PlayerCount;
  startPoints: number;
  returnPoints: number;
  uma: number[];
  ryuukyokuPoolTotal: number;
  honbaPerPayer: number;
  roundLength: 'east' | 'south';
  endTarget: number;
  maxRounds: number;
  dealerFinish: boolean;
  bustEndsMatch: boolean;
  openTanyao: boolean;
  redFives: number;
  kiriageMangan: boolean;
  kazoeYakuman: boolean;
  sanmaTsumoLoss: boolean;
  doubleRon: boolean;
}
export interface RuleTemplate { id: string; name: string; source: string; difference: string; rules: TableRules; }

const four: TableRules = {
  playerCount: 4, startPoints: 30000, returnPoints: 30000, uma: [15, 5, -5, -15],
  ryuukyokuPoolTotal: 3000, honbaPerPayer: 100, roundLength: 'south', endTarget: 30000,
  maxRounds: 12, dealerFinish: true, bustEndsMatch: true, openTanyao: true, redFives: 0,
  kiriageMangan: false, kazoeYakuman: true, sanmaTsumoLoss: false, doubleRon: false,
};
const three: TableRules = {
  ...four, playerCount: 3, startPoints: 35000, returnPoints: 40000, uma: [20, 0, -20],
  ryuukyokuPoolTotal: 2000, honbaPerPayer: 100, endTarget: 40000, redFives: 2,
  sanmaTsumoLoss: true, doubleRon: true,
};
export const presets: RuleTemplate[] = [
  { id: 'wrc-ref', name: '四麻国际竞技参考 v1', source: '对照 WRC 2025 · 参考／待验证', difference: '低点立直、负分续行、同点马点、终局供托与比赛处罚未完全覆盖；不可视为 WRC 兼容。', rules: four },
  { id: 'sanma-ref', name: '三麻常见玩法参考 v1', source: '对照天凤三麻说明 · 参考／待验证', difference: '流局罚符 2,000 为产品候选值；拔北、宝牌及支付差异待核对，非平台官方规则。', rules: three },
  { id: 'four-home', name: '四麻家规 v1', source: '本产品家规示例', difference: '25,000 起／30,000 返；赤五三枚；双响成立。', rules: { ...four, startPoints: 25000, uma: [20, 10, -10, -20], redFives: 3, doubleRon: true } },
  { id: 'three-home', name: '三麻家规 v1', source: '本产品家规示例', difference: '3,000 流局罚符；自摸损；双响成立。', rules: { ...three, ryuukyokuPoolTotal: 3000 } },
];

export const winds = ['东', '南', '西', '北'];
export const pointText = (n: number) => n.toLocaleString('zh-CN');
export function rulesSnapshot(rules: TableRules): RulesSnapshot {
  // Temporary snapshots are not server-verified hashes. Server must hash and validate at creation.
  return { rulesHash: 'local-preview', config: { ...rules, uma: [...rules.uma] } };
}
export function initialHand(rules: TableRules, handId = 'preview'): HandState {
  return {
    handId, roundWind: 'E', roundNumber: 1, dealerSeatNo: 0, honba: 0, riichiPool: 0,
    markRevision: 0n, resultRevision: 0n,
    seats: Array.from({ length: rules.playerCount }, (_, seatNo) => ({
      seatNo, points: rules.startPoints, isRiichi: false, isTenpai: null,
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
  const points = [rules.startPoints, rules.returnPoints, rules.endTarget, rules.ryuukyokuPoolTotal, rules.honbaPerPayer];
  if (points.some((n) => !Number.isInteger(n) || n < 0 || n % 100 !== 0) || rules.startPoints < 1000) return '点数需为非负整百；起始点至少 1,000。';
  if (rules.uma.length !== rules.playerCount || rules.uma.some((n) => !Number.isInteger(n))) return '马点需为每座填写整数。';
  if (rules.maxRounds < (rules.roundLength === 'east' ? 4 : 8) || !Number.isInteger(rules.maxRounds)) return '延长上限不能短于所选场次。';
  if (rules.redFives < 0 || rules.redFives > (rules.playerCount === 3 ? 2 : 3) || !Number.isInteger(rules.redFives)) return '赤宝牌枚数超出该人数支持范围。';
  if (rules.ryuukyokuPoolTotal % (rules.playerCount === 3 ? 2 : 6) !== 0) return '流局罚符需能按听牌人数逐笔整百分摊。';
  return null;
}
export function oka(rules: TableRules): number {
  return (rules.returnPoints - rules.startPoints) * rules.playerCount / 1000 - rules.uma.reduce((a, b) => a + b, 0);
}
