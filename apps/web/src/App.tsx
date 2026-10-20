import { useMemo, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { calculateSettlement, ENGINE_VERSION } from '@riichi/engine';
import type { HandState, ResultInput, SettlementOutput } from '@riichi/engine';
import { exampleResults, initialHand, oka, pointText, presets, rulesError, rulesSnapshot, winds } from './rules';
import type { RuleTemplate, TableRules } from './rules';
import './style.css';

type Match = { id: string; name: string; rules: TableRules; hand: HandState; template: string; handsPlayed: number };
type Preview = { output: SettlementOutput | null; error: boolean };

function preview(rules: TableRules, hand: HandState, result: ResultInput): Preview {
  try {
    return { output: calculateSettlement(rulesSnapshot(rules), hand, result, ENGINE_VERSION), error: false };
  } catch {
    return { output: null, error: true };
  }
}
function applySettlement(match: Match, output: SettlementOutput): Match {
  // Only the engine's full per-seat batch changes balances; the riichi marks alone never do.
  const payments = new Map(output.perSeat.map((seat) => [seat.seatNo, seat.netPoints]));
  if (payments.size !== match.hand.seats.length || match.hand.seats.some((seat) => !payments.has(seat.seatNo))) {
    throw new Error('结算缺少座位支付');
  }
  return {
    ...match, handsPlayed: match.handsPlayed + 1,
    hand: {
      ...match.hand, ...output.nextHand, handId: `${match.id}-${match.handsPlayed + 2}`,
      markRevision: 0n, resultRevision: match.hand.resultRevision + 1n,
      seats: match.hand.seats.map((seat) => ({
        ...seat, points: seat.points + payments.get(seat.seatNo)!, isRiichi: false, isTenpai: null,
      })),
    },
  };
}

function EngineFallback() {
  return <div className="notice" role="status"><strong>结算引擎接入中</strong><span>暂无法提供可靠支付明细；本局不能提交。请稍后再试。</span></div>;
}
function Payments({ output }: { output: SettlementOutput }) {
  return <div className="payment-list">{output.perSeat.map((seat) => <div className="payment-row" key={seat.seatNo}>
    <span>{winds[seat.seatNo]}家</span><strong className={seat.netPoints > 0 ? 'gain' : seat.netPoints < 0 ? 'loss' : ''}>{seat.netPoints > 0 ? '+' : ''}{pointText(seat.netPoints)}</strong>
    <small>{seat.breakdown.map((part) => `${part.reason} ${part.amount > 0 ? '+' : ''}${pointText(part.amount)}`).join(' · ')}</small>
  </div>)}</div>;
}
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="app-shell"><header className="topbar"><Link to="/" className="brand"><span className="brand-tile">東</span><span>雀卓<span className="brand-sub"> / RIICHI TRACKER</span></span></Link><nav aria-label="主导航"><Link to="/">大厅</Link><Link to="/create">开桌</Link><Link to="/history">战绩</Link><Link to="/login">登录</Link></nav></header>{children}<footer className="footer">线下记分 · 本地演示数据未同步或备份至云端 <span>ENGINE {ENGINE_VERSION}</span></footer></div>;
}
function Home({ match, templates }: { match: Match | null; templates: RuleTemplate[] }) {
  return <Shell><main className="page"><section className="hero"><div><p className="eyebrow">线下日麻 · 记分桌</p><h1>落座，即开局。</h1><p>从规则到结算，给同桌每一分一个清楚的去处。</p><div className="hero-actions"><Link className="button primary" to="/create">开桌 <span>↗</span></Link>{match && <Link className="button" to={`/table/${match.id}`}>继续对局 · {match.name}</Link>}</div></div><div className="hero-object" aria-hidden="true"><span>一</span><span>萬</span><small>東 一 局</small></div></section><div className="section-heading"><span>桌边入口</span><small>01 / 03</small></div><div className="entry-grid"><Link to="/create" className="entry"><b>01</b><h2>开桌</h2><p>选规则，调数值，预览支付。</p><span>建立牌局 →</span></Link><Link to="/create#templates" className="entry"><b>02</b><h2>我的模板</h2><p>{templates.length ? `${templates.length} 份本地模板` : '还没有保存的模板'}</p><span>查看模板 →</span></Link><Link to="/history" className="entry"><b>03</b><h2>战绩</h2><p>对局历史与成绩入口。</p><span>查看战绩 →</span></Link></div></main></Shell>;
}
function Login() {
  return <Shell><main className="page narrow"><p className="eyebrow">ACCOUNT / 账户</p><h1>登录雀卓</h1><section className="panel"><p className="muted">账户服务尚未接入；此表单不会提交凭据。</p><form onSubmit={(event) => event.preventDefault()}><label>邮箱<input type="email" name="email" autoComplete="email" placeholder="name@example.com" required /></label><label>密码<input type="password" name="password" autoComplete="current-password" required /></label><button type="submit" disabled>登录 · 尚未开放</button></form><p className="note">TODO：接入账户认证后启用提交与模板云同步。</p></section></main></Shell>;
}
function History() {
  return <Shell><main className="page"><p className="eyebrow">RECORD / 战绩</p><h1>对局记录</h1><p className="muted">以下为示例数据，不代表真实战绩。本地牌局暂不会写入历史。</p><div className="history-list">{[
    ['周六半庄', '四麻 · 南四局', '+32.5', '示例数据'],
    ['夜间东风', '三麻 · 东四局', '−12.0', '示例数据'],
  ].map(([name, round, score, label]) => <div className="history-row" key={name}><span className="tile-mini">中</span><div><strong>{name}</strong><small>{round}</small></div><b>{score}</b><em>{label}</em></div>)}</div></main></Shell>;
}

function RulePreview({ rules }: { rules: TableRules }) {
  const samples = useMemo(() => exampleResults(rules).map((sample) => ({
    ...sample, preview: preview(rules, initialHand(rules), sample.input),
  })), [rules]);
  return <section className="panel preview-panel"><div className="section-heading"><span>支付预览</span><small>正式引擎 · 固定示例状态</small></div><p className="muted">东一局 · 0 本场 · 无供托 · 无立直。每次修改规则重新计算；三麻同时展示一人与两人听牌。</p><div className="sample-grid">{samples.map((sample) => <div className="sample" key={sample.title}><h3>{sample.title}</h3>{sample.preview.output ? <Payments output={sample.preview.output} /> : <EngineFallback />}</div>)}</div></section>;
}
function NumberField({ label, value, onChange, step = 100, hint }: { label: string; value: number; onChange: (value: number) => void; step?: number; hint?: string }) {
  return <label>{label}<input type="number" inputMode="numeric" step={step} value={value} onChange={(event) => onChange(event.target.value === '' ? NaN : Number(event.target.value))} />{hint && <small>{hint}</small>}</label>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}
function Create({ templates, addTemplate, start }: { templates: RuleTemplate[]; addTemplate: (template: RuleTemplate) => void; start: (rules: TableRules, name: string) => void }) {
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<RuleTemplate | null>(null);
  const [rules, setRules] = useState<TableRules | null>(null);
  const [stage, setStage] = useState<'pick' | 'edit' | 'seats'>('pick');
  const [templateName, setTemplateName] = useState('');
  const [saved, setSaved] = useState('');
  const [tableName, setTableName] = useState('周末牌桌');
  const change = (patch: Partial<TableRules>) => setRules((current) => current ? { ...current, ...patch } : current);
  const select = (template: RuleTemplate) => {
    setChosen(template); setRules({ ...template.rules, uma: [...template.rules.uma] }); setStage('edit'); setSaved('');
  };
  const error = rules ? rulesError(rules) : null;
  return <Shell><main className="page"><p className="eyebrow">NEW TABLE / 开桌</p><h1>开一桌好牌</h1><div className="steps"><span className={stage === 'pick' ? 'active' : ''}>01 选模板</span><span className={stage === 'edit' ? 'active' : ''}>02 调规则与预览</span><span className={stage === 'seats' ? 'active' : ''}>03 签到与座次</span></div>
    {stage === 'pick' && <><div className="section-heading"><span>预置模板</span><small>只读 · 选择起点</small></div><div className="template-grid">{presets.map((template) => <article className="template" key={template.id}><div className="template-top"><span className="tag">{template.rules.playerCount} 麻</span><span className="tag muted-tag">参考／示例</span></div><h2>{template.name}</h2><p>{template.source}</p><small>{template.difference}</small><button type="button" onClick={() => select(template)}>以此为起点调整 →</button><button type="button" className="quiet" onClick={() => { select(template); setStage('seats'); }}>直接应用</button></article>)}</div><div className="section-heading" id="templates"><span>我的模板</span><small>只读 · 可作为新模板起点</small></div>{templates.length ? <div className="template-grid">{templates.map((template) => <article className="template" key={template.id}><span className="tag">{template.rules.playerCount} 麻 · 本地</span><h2>{template.name}</h2><p>{template.difference}</p><button type="button" onClick={() => select(template)}>以此为起点调整 →</button><button type="button" className="quiet" onClick={() => { select(template); setStage('seats'); }}>直接应用</button></article>)}</div> : <div className="empty">尚无我的模板。选择预置模板并调整后，可在此浏览器会话中另存一份。</div>}</>}
    {rules && stage === 'edit' && <><div className="section-heading"><span>{chosen?.name} · 调整副本</span><button type="button" className="text-button" onClick={() => setStage('pick')}>重新选模板</button></div><p className="muted">预置与已保存模板均只读；当前修改仅作用于这桌的待开局快照。人数固定，切换人数请另选模板。立直棒固定 1,000 点。</p><div className="rule-layout"><div className="panel rules-form"><h2>比赛与局次</h2><div className="field-grid"><NumberField label="起始点" value={rules.startPoints} onChange={(startPoints) => change({ startPoints })} /><NumberField label="返还点" value={rules.returnPoints} onChange={(returnPoints) => change({ returnPoints })} /><NumberField label="终局目标点" value={rules.endTarget} onChange={(endTarget) => change({ endTarget })} /><label>场次<select value={rules.roundLength} onChange={(event) => change({ roundLength: event.target.value as TableRules['roundLength'], maxRounds: Math.max(rules.maxRounds, event.target.value === 'east' ? 4 : 8) })}><option value="east">东风</option><option value="south">半庄</option></select></label><NumberField label="延长上限（局）" value={rules.maxRounds} step={1} onChange={(maxRounds) => change({ maxRounds })} /></div><div className="field-grid uma-grid">{rules.uma.map((value, i) => <NumberField key={i} label={`${i + 1} 位马点`} value={value} step={1} onChange={(next) => change({ uma: rules.uma.map((v, n) => n === i ? next : v) })} />)}</div><p className="rule-detail">头名赏：{oka(rules)} 竞技分（由起始点、返还点和马点自动得出；竞技分总和归零）</p><h2>局内支付</h2><div className="field-grid"><NumberField label="荒牌流局罚符总额" value={rules.ryuukyokuPoolTotal} onChange={(ryuukyokuPoolTotal) => change({ ryuukyokuPoolTotal })} /><NumberField label="本场 · 每位付款额" value={rules.honbaPerPayer} onChange={(honbaPerPayer) => change({ honbaPerPayer })} hint={`荣和总额 ${pointText(rules.honbaPerPayer * (rules.playerCount - 1))} / 本；自摸每位付款同额`} /></div><h2>支持的开关</h2><div className="switch-grid"><Toggle label="飞人结束（负分）" checked={rules.bustEndsMatch} onChange={(bustEndsMatch) => change({ bustEndsMatch })} /><Toggle label="末局庄家满足目标点且独占第一可结束" checked={rules.dealerFinish} onChange={(dealerFinish) => change({ dealerFinish })} /><Toggle label="食断" checked={rules.openTanyao} onChange={(openTanyao) => change({ openTanyao })} /><Toggle label="切上满贯" checked={rules.kiriageMangan} onChange={(kiriageMangan) => change({ kiriageMangan })} /><Toggle label="累计役满（13 番起）" checked={rules.kazoeYakuman} onChange={(kazoeYakuman) => change({ kazoeYakuman })} /><Toggle label="双响成立" checked={rules.doubleRon} onChange={(doubleRon) => change({ doubleRon })} />{rules.playerCount === 3 && <Toggle label="三麻自摸损（关闭为补偿模式，需引擎支持）" checked={rules.sanmaTsumoLoss} onChange={(sanmaTsumoLoss) => change({ sanmaTsumoLoss })} />}</div><div className="field-grid"><NumberField label="赤宝牌枚数" value={rules.redFives} step={1} onChange={(redFives) => change({ redFives })} /></div><p className="note">包牌、流局满贯及自动诈和罚符未开放。参考模板来源差异尚待验证，不能作为来源方的兼容规则使用。</p></div><aside className="rule-side"><div className="panel"><h3>本桌规则摘要</h3><p>{rules.playerCount} 麻 · {rules.roundLength === 'east' ? '东风' : '半庄'} · {pointText(rules.startPoints)} 起 / {pointText(rules.returnPoints)} 返</p><p>流局 {pointText(rules.ryuukyokuPoolTotal)} · 本场每付款者 {pointText(rules.honbaPerPayer)}</p><p>{chosen?.difference}</p></div></aside></div>{error && <div className="notice invalid" role="alert">{error}</div>} {!error && <RulePreview rules={rules} />}<div className="sticky-actions"><div><p>当前操作仅在此浏览器会话中有效；登录后才能长期保存并同步私人模板。</p><input aria-label="新模板名称" placeholder="新模板名称（另存时填写）" value={templateName} maxLength={40} onChange={(event) => setTemplateName(event.target.value)} />{saved && <small role="status">{saved}</small>}</div><button type="button" disabled={!!error} onClick={() => setStage('seats')}>仅用于本桌 →</button><button type="button" className="primary" disabled={!!error || !templateName.trim()} onClick={() => { const name = templateName.trim(); addTemplate({ id: crypto.randomUUID(), name, source: '我的模板 · 本地会话', difference: `${rules.playerCount} 麻 · ${pointText(rules.startPoints)} 起 / ${pointText(rules.returnPoints)} 返`, rules: { ...rules, uma: [...rules.uma] } }); setSaved(`「${name}」已保存在当前会话；登录后方可同步。`); setTemplateName(''); }}>另存为我的模板</button></div></>}
    {rules && stage === 'seats' && <><button type="button" className="text-button" onClick={() => setStage('edit')}>← 返回调整规则</button><section className="checkin panel"><div><p className="eyebrow">CHECK IN / 签到</p><h2>确认座次</h2><label>本桌名称<input value={tableName} maxLength={40} onChange={(event) => setTableName(event.target.value)} /></label><p>{chosen?.name} · {rules.playerCount} 麻 · {pointText(rules.startPoints)} 点</p><p className="muted">规则应用于本桌本地快照。签到与真实二维码尚未接入；此处仅为座位演示，不代表成员已到场。</p><div className="member-list">{Array.from({ length: rules.playerCount }, (_, i) => <div key={i}><span className="wind-badge">{winds[i]}</span><span>座位 {i + 1} · 待认领</span><small>未签到</small></div>)}</div><button className="primary" type="button" disabled={!tableName.trim()} onClick={() => { start(rules, tableName.trim()); navigate('/table/local'); }}>进入本地演示牌桌 →</button></div><div className="qr-wrap"><div className="qr-placeholder" aria-label="二维码占位，不可扫码"><span>QR</span><small>签到功能接入中</small></div><p>二维码占位 · 暂不可扫码</p></div></section></>}
  </main></Shell>;
}

function Table({ match, update }: { match: Match | null; update: (match: Match) => void }) {
  const { id } = useParams();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'ron' | 'tsumo' | 'ryuukyoku'>('ron');
  const [winner, setWinner] = useState(0);
  const [dealIn, setDealIn] = useState(1);
  const [han, setHan] = useState(2);
  const [fu, setFu] = useState(30);
  const [tenpai, setTenpai] = useState<boolean[]>([false, false, false, false]);
  const [submitError, setSubmitError] = useState('');
  if (!match || (id !== match.id && id !== 'local')) return <Shell><main className="page narrow"><h1>牌桌不存在</h1><p>本地演示牌桌只保留在当前页面会话。请重新开桌。</p><Link className="button primary" to="/create">前往开桌</Link></main></Shell>;
  const hand = match.hand;
  const result: ResultInput = kind === 'ryuukyoku' ? { kind, winners: [], tenpai: tenpai.slice(0, hand.seats.length) } : {
    kind, winners: [{ seatNo: winner, han, fu, ...(kind === 'ron' ? { dealInSeatNo: dealIn } : {}) }],
  };
  const invalid = kind !== 'ryuukyoku' && (!Number.isInteger(han) || han < 1 || !Number.isInteger(fu) || fu < 20 || (kind === 'ron' && winner === dealIn));
  const payment = open && !invalid ? preview(match.rules, hand, result) : null;
  const mark = (seatNo: number) => {
    const seat = hand.seats[seatNo];
    if (!seat.isRiichi && seat.points < 1000) return;
    update({ ...match, hand: { ...hand, markRevision: hand.markRevision + 1n, seats: hand.seats.map((s) => s.seatNo === seatNo ? { ...s, isRiichi: !s.isRiichi } : s) } });
  };
  const settle = () => {
    if (invalid) return;
    const fresh = preview(match.rules, match.hand, result);
    if (!fresh.output) { setSubmitError('结算引擎接入中，未更新任何点数。'); return; }
    try {
      update(applySettlement(match, fresh.output));
      setSubmitError(''); setOpen(false); setTenpai([false, false, false, false]);
    } catch { setSubmitError('支付明细不完整，未更新任何点数。'); }
  };
  return <Shell><main className="page table-page"><div className="table-heading"><div><p className="eyebrow">LOCAL TABLE / 本地演示</p><h1>{match.name}</h1><p className="muted">{match.template} · 规则已锁定 · 本页状态未同步或备份</p></div><button type="button" className="button" onClick={() => setOpen(true)}>录入本局结果 →</button></div><div className="table-layout"><section className="felt" aria-label="牌桌座位"><div className="felt-lines" aria-hidden="true" /><div className="seat-grid">{hand.seats.map((seat) => <article className={`seat seat-${seat.seatNo}`} key={seat.seatNo}><div className="seat-top"><span className="wind-badge">{winds[seat.seatNo]}</span><span>座位 {seat.seatNo + 1}{hand.dealerSeatNo === seat.seatNo && <em>庄家</em>}</span></div><strong>{pointText(seat.points)}</strong><button type="button" className={seat.isRiichi ? 'riichi marked' : 'riichi'} aria-pressed={seat.isRiichi} disabled={!seat.isRiichi && seat.points < 1000} onClick={() => mark(seat.seatNo)}>{seat.isRiichi ? '立直 · 已标记' : '标记立直'}</button></article>)}<div className="table-center"><span>{hand.roundWind === 'E' ? '东' : hand.roundWind === 'S' ? '南' : '西'}{['一', '二', '三', '四'][hand.roundNumber - 1] ?? hand.roundNumber}局</span><b>{hand.honba} 本场</b><small>供托 {hand.riichiPool} 根</small></div></div></section><aside className="panel table-aside"><h2>当前局</h2><div className="aside-stat"><span>局数</span><b>{match.handsPlayed + 1}</b></div><div className="aside-stat"><span>立直标记版本</span><b>{String(hand.markRevision)}</b></div><p className="note">立直标记为同桌待确认状态：点击仅标记，不扣点。提交结算时引擎才扣立直棒并计算供托；宣言牌被荣和的标记可在确认前取消。</p><button type="button" className="primary" onClick={() => setOpen(true)}>荣和 / 自摸 / 流局</button></aside></div>
    {open && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section className="dialog panel" role="dialog" aria-modal="true" aria-label="录入结算"><div className="dialog-head"><div><p className="eyebrow">SETTLEMENT / 本局结算</p><h2>支付确认</h2></div><button type="button" className="close" aria-label="关闭" onClick={() => setOpen(false)}>×</button></div><p className="muted">按当前立直标记预览；提交前请同桌确认。引擎不可用时禁止提交。</p><div className="segmented" role="group" aria-label="结果类型">{(['ron', 'tsumo', 'ryuukyoku'] as const).map((value) => <button type="button" key={value} className={kind === value ? 'selected' : ''} onClick={() => { setKind(value); setSubmitError(''); }}>{({ ron: '荣和', tsumo: '自摸', ryuukyoku: '荒牌流局' })[value]}</button>)}</div>{kind === 'ryuukyoku' ? <div className="tenpai-grid">{hand.seats.map((seat) => <Toggle key={seat.seatNo} label={`${winds[seat.seatNo]}家听牌`} checked={tenpai[seat.seatNo]} onChange={(value) => setTenpai((current) => current.map((v, i) => i === seat.seatNo ? value : v))} />)}</div> : <div className="field-grid"><label>和牌座位<select value={winner} onChange={(event) => setWinner(Number(event.target.value))}>{hand.seats.map((seat) => <option key={seat.seatNo} value={seat.seatNo}>{winds[seat.seatNo]}家</option>)}</select></label>{kind === 'ron' && <label>放铳座位<select value={dealIn} onChange={(event) => setDealIn(Number(event.target.value))}>{hand.seats.map((seat) => <option key={seat.seatNo} value={seat.seatNo}>{winds[seat.seatNo]}家</option>)}</select></label>}<NumberField label="番" step={1} value={han} onChange={setHan} /><NumberField label="符" step={1} value={fu} onChange={setFu} /></div>}{invalid ? <div className="notice invalid" role="alert">请输入有效番符；荣和的胜者与放铳者不可相同。</div> : payment?.output ? <><h3>逐座支付</h3><Payments output={payment.output} /><p className="rule-detail">下一局：{payment.output.nextHand.honba} 本场 · 供托 {payment.output.nextHand.riichiPool} 根</p></> : <EngineFallback />}{submitError && <div className="notice invalid" role="alert">{submitError}</div>}<div className="dialog-actions"><button type="button" onClick={() => setOpen(false)}>取消</button><button type="button" className="primary" disabled={invalid || !payment?.output} onClick={settle}>确认并应用逐座支付</button></div></section></div>}
  </main></Shell>;
}
export default function App() {
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [match, setMatch] = useState<Match | null>(null);
  return <BrowserRouter><Routes><Route path="/" element={<Home match={match} templates={templates} />} /><Route path="/login" element={<Login />} /><Route path="/history" element={<History />} /><Route path="/create" element={<Create templates={templates} addTemplate={(template) => setTemplates((current) => [...current, template])} start={(rules, name) => setMatch({ id: 'local', name, rules: { ...rules, uma: [...rules.uma] }, hand: initialHand(rules, 'local-1'), template: '本地规则快照', handsPlayed: 0 })} />} /><Route path="/table/:id" element={<Table match={match} update={setMatch} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></BrowserRouter>;
}
