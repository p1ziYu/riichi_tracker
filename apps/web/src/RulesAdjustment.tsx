import type { TableRules } from './rules';
import { oka, pointText, ruleOverrides } from './rules';
import Segmented from './Segmented';

function Choices<T extends string | boolean>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return <div className="rule-choice"><span>{label}</span><Segmented label={label} options={options} value={value} onChange={onChange} /></div>;
}
const yesNo = [{ value: true, label: '开启' }, { value: false, label: '关闭' }];
const umaPresets = {
  4: [{ label: '+20 / +10 / -10 / -20', value: [20, 10, -10, -20] },
    { label: '+15 / +5 / -5 / -15', value: [15, 5, -5, -15] },
    { label: '+30 / +10 / -10 / -30', value: [30, 10, -10, -30] },
    { label: '+10 / +5 / -5 / -10', value: [10, 5, -5, -10] },
    { label: '无马点', value: [0, 0, 0, 0] }],
  3: [{ label: '+20 / 0 / -20', value: [20, 0, -20] },
    { label: '+30 / 0 / -30', value: [30, 0, -30] },
    { label: '+10 / 0 / -10', value: [10, 0, -10] },
    { label: '无马点', value: [0, 0, 0] }],
};

export default function RulesAdjustment({ base, rules, onChange }: {
  base: TableRules; rules: TableRules; onChange: (rules: TableRules) => void;
}) {
  const changed = Object.keys(ruleOverrides(base, rules)).length;
  const numeric = (key: 'startingPoints' | 'returnPoints' | 'targetPoints' | 'notenPenaltyTotal' | 'honbaRon' | 'honbaPerPayer', label: string, presets?: number[]) =>
    <div className="rule-number" key={key}><label>{label}<input type="number" step="100" inputMode="numeric" value={rules[key]}
      onChange={(event) => { const value = event.target.value === '' ? NaN : Number(event.target.value);
        onChange({ ...rules, [key]: value,
          ...(key === 'startingPoints' || key === 'returnPoints' ? { oka: ( (key === 'returnPoints' ? value : rules.returnPoints) - (key === 'startingPoints' ? value : rules.startingPoints)) * rules.playerCount / 1000 } : {}),
          ...(key === 'honbaRon' ? { honbaPerPayer: value / (rules.playerCount - 1) } : {}),
          ...(key === 'honbaPerPayer' ? { honbaRon: value * (rules.playerCount - 1) } : {}),
        }); }} /></label>{presets && <div className="rule-presets">{presets.map((value) => <button type="button" key={value} onClick={() => onChange({ ...rules, [key]: value,
          ...(key === 'startingPoints' || key === 'returnPoints' ? { oka: ((key === 'returnPoints' ? value : rules.returnPoints) - (key === 'startingPoints' ? value : rules.startingPoints)) * rules.playerCount / 1000 } : {}),
        })}>{pointText(value)}</button>)}</div>}</div>;
  const choice = <T extends string | boolean>(key: keyof TableRules, label: string, options: { value: T; label: string }[]) =>
    <Choices key={key} label={label} value={rules[key] as T} options={options}
      onChange={(value) => onChange({ ...rules, [key]: value })} />;
  return <details className="panel rules-adjustment"><summary>规则调整 <strong>{changed ? `已自定义 ${changed} 项` : '已按模板'}</strong></summary>
    <p className="muted">只调整本桌；模板保持不变。人数与立直棒固定，人数请从模板重新选择。</p>
    <button type="button" className="text-button" disabled={!changed} onClick={() => onChange({ ...base, uma: [...base.uma] })}>恢复模板默认规则</button>
    <h3>比赛与局次</h3><div className="field-grid">
      {numeric('startingPoints', '起始点', [25000, 30000, 35000])}
      {numeric('returnPoints', '返还点', [30000, 40000])}
      {numeric('targetPoints', '终局目标点', [30000, 40000])}
    </div><p className="rule-detail">头名赏（只读）：{oka(rules)} 竞技分；由起始点、返还点及人数决定。</p>
    <div className="rule-presets" role="group" aria-label="马点预设">{umaPresets[rules.playerCount].map((preset) =>
      <button type="button" key={preset.label} onClick={() => onChange({ ...rules, uma: [...preset.value] })}>{preset.label}</button>)}</div>
    <div className="field-grid uma-grid">{rules.uma.map((value, index) => <label key={index}>{index + 1} 位马点
      <input type="number" step="0.1" value={value} onChange={(event) => onChange({ ...rules,
        uma: rules.uma.map((point, at) => at === index ? event.target.value === '' ? NaN : Number(event.target.value) : point),
      })} /></label>)}</div>
    {choice('fixedSouth4EndPolicy', '末局结束条件', rules.playerCount === 4
      ? [{ value: 'completed_south_4', label: '打完南四局' }, { value: 'target_or_bust', label: '目标点或飞人' }]
      : [{ value: 'target_or_bust', label: '目标点或飞人（三麻南三末局）' }])}
    {choice('automaticEndPolicy', '自动终局', [{ value: 'manual', label: '手动' }, ...(rules.playerCount === 3 ? [{ value: 'ranked_sanma', label: '三麻段位' }] : [])])}
    {choice('bustEndsGame', '飞人结束（负分）', yesNo)}
    {choice('terminalRiichiPoolPolicy', '终局供托', [{ value: 'first', label: '首位领取' }, { value: 'unallocated', label: '不分配' }])}
    {choice('tiedUmaPolicy', '同点马点', [{ value: 'seat_order', label: '按起家座次' }, { value: 'split', label: '均分' }])}
    <h3>局内支付</h3><div className="field-grid">
      {numeric('notenPenaltyTotal', '荒牌流局罚符总额', rules.playerCount === 3 ? [0, 2000, 3000] : [0, 3000])}
      <div className="rule-number"><button type="button" disabled title="引擎按所有听牌人数逐笔以 100 点结算，1,500 点无法整百分摊">1,500（不支持）</button><small>1,500 点无法按所有听牌人数以整百分摊。</small></div>
      {numeric('honbaRon', '本场荣和总额', rules.playerCount === 3 ? [200, 400] : [300, 600])}
      {numeric('honbaPerPayer', '本场自摸每付款者', [100, 200])}
    </div>
    {choice('multiRon', '多家荣和', [{ value: 'head_bump', label: '头跳' }, { value: 'double_ron', label: '双响' }, { value: 'allow_all', label: '允许全部' }])}
    {rules.multiRon !== 'head_bump' && choice('doubleRonHonbaPolicy', '双响本场分配', [{ value: 'nearest_only', label: '仅最近一家' }, { value: 'each_winner', label: '每位赢家各一份' }])}
    {rules.multiRon !== 'head_bump' && <p className="rule-detail">双荣供托固定由距离放铳者最近的赢家领取；上述选项只决定每本本场支付给几位赢家。</p>}
    {choice('allowLowPointRiichi', '低于 1,000 点可立直', yesNo)}
    {choice('nagashiManganEnabled', '流局满贯', yesNo)}
    {choice('nagashiCollectsRiichiPool', '流局满贯收取供托', yesNo)}
    {choice('nagashiDealerRepeatRequiresTenpai', '流局满贯庄家需听牌方连庄', yesNo)}
    {rules.playerCount === 3 && choice('tsumoLoss', '三麻自摸损', yesNo)}
    <h3>番数与役满</h3>
    {choice('kiriageMangan', '切上满贯', yesNo)}
    {choice('kazoeYakuman', '累计役满', yesNo)}
    {choice('compositeYakuman', '复合役满', yesNo)}
    {choice('doubleYakuman', '双倍役满', yesNo)}
  </details>;
}
