import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { calculateSettlement, ENGINE_VERSION } from '@riichi/engine';
import type { SettlementOutput } from '@riichi/engine';
import { ApiError, api, clearNativeAuthToken, errorText, post } from './api';
import { exampleResults, initialHand, oka, pointText, rulesError, rulesSnapshot, winds } from './rules';
import type { RuleTemplate, TableRules } from './rules';
import Table from './Table';
import BottomTabs from './BottomTabs';
import './style.css';

type Principal = { id: string; type: 'account' | 'guest'; displayName: string };
type MatchSummary = { id: string; status: string; playerCount: number; createdAt: string };
const kindLabels: Record<string, string> = { '4p': '四麻', '3p': '三麻' };
type ServerTemplate = { templateId: string; templateKey: string; kind: string; scope: string; versionId: string; name: string; reviewStatus: string; config: TableRules };
const reviewLabels: Record<string, string> = {
  approved: '已审核', pending: '待审核', rejected: '未通过', draft: '草稿',
  verified: '已审核', unreviewed: '待审核',
};
const matchLabels: Record<string, string> = {
  preparing: '等待座次确认', lobby: '等待座次确认', active: '牌局进行中', in_progress: '牌局进行中', finished: '牌局已结束',
};

function Shell({ children, principal }: { children: React.ReactNode; principal: Principal | null }) {
  const bridge = (window as Window & { Capacitor?: { getPlatform?: () => string; platform?: string; isNativePlatform?: () => boolean } }).Capacitor;
  return <div className={`app-shell${bridge?.isNativePlatform?.() && (bridge.getPlatform?.() ?? bridge.platform) === 'ios' ? ' ios-native' : ''}`}>
    <header className="topbar"><Link to="/" className="brand"><span className="brand-tile">東</span><span>雀卓<span className="brand-sub"> / RIICHI TRACKER</span></span></Link></header>
    {children}
    <footer className="footer">线下记分 · 牌局数据实时同步 <span>ENGINE {ENGINE_VERSION}</span></footer>
    <BottomTabs signedIn={!!principal} />
  </div>;
}

function MatchList() {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api<MatchSummary[]>('/api/matches?mine=1').then((data) => { if (alive) setMatches(data); }).catch((cause: unknown) => { if (alive) setError(errorText(cause)); });
    return () => { alive = false; };
  }, []);
  return <>{error && <div className="notice invalid" role="alert">读取战绩失败：{error}</div>}{!error && !matches && <p className="muted">正在读取战绩…</p>}{matches && (matches.length ? <div className="history-list">{matches.map((match) => <Link className="history-row" to={`/table/${match.id}`} key={match.id}><span className="tile-mini">中</span><div><strong>牌桌 {match.id}</strong><small>{match.playerCount} 麻 · {new Date(match.createdAt).toLocaleString('zh-CN')}</small></div><b>{matchLabels[match.status] ?? match.status}</b><em>查看牌桌 →</em></Link>)}</div> : <div className="empty">暂无对局记录。</div>)}</>;
}

function Home({ templateCount }: { templateCount: number }) {
  return <main className="page"><section className="hero"><div><p className="eyebrow">线下日麻 · 记分桌</p><h1>落座，即开局。</h1><p>从规则到结算，给同桌每一分一个清楚的去处。</p><div className="hero-actions"><Link className="button primary" to="/create">开桌 <span>↗</span></Link></div></div><div className="hero-object" aria-hidden="true"><span>一</span><span>萬</span><small>東 一 局</small></div></section><div className="section-heading"><span>桌边入口</span><small>01 / 03</small></div><div className="entry-grid"><Link to="/create" className="entry"><b>01</b><h2>开桌</h2><p>选规则，调数值，预览支付。</p><span>建立牌局 →</span></Link><Link to="/create#templates" className="entry"><b>02</b><h2>我的模板</h2><p>{templateCount ? `${templateCount} 份本地模板` : '查看私人模板'}</p><span>查看模板 →</span></Link><Link to="/history" className="entry"><b>03</b><h2>战绩</h2><p>对局历史与成绩入口。</p><span>查看战绩 →</span></Link></div><div className="section-heading" id="战绩"><span>战绩</span><Link to="/history">查看全部 →</Link></div><MatchList /></main>;
}

function checkInReturnTo(value: string | null): string {
  return value && /^\/checkin\/[^/?#]+(?:[?#]|$)/.test(value) ? value : '/';
}

function Login({ onAuthenticated }: { onAuthenticated: (principal: Principal) => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = checkInReturnTo(params.get('returnTo'));
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function enter(path: string, body: object) {
    setBusy(true); setError('');
    try {
      await post(path, body);
      const { principal } = await api<{ principal: Principal }>('/api/me');
      navigate(returnTo, { replace: true });
      onAuthenticated(principal);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <main className="page narrow"><p className="eyebrow">ACCOUNT / 账户</p><h1>登录雀卓</h1><section className="panel"><div className="segmented"><button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => setMode('login')}>邮箱登录</button><button type="button" className={mode === 'register' ? 'selected' : ''} onClick={() => setMode('register')}>注册账户</button></div><form onSubmit={(event) => { event.preventDefault(); void enter(mode === 'login' ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email', mode === 'login' ? { email, password } : { email, password, name }); }}>{mode === 'register' && <label>昵称<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>}<label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label><button className="primary" type="submit" disabled={busy}>{mode === 'login' ? '登录' : '注册并登录'}</button></form><p className="note">无需邮箱？可以先以访客身份入桌。</p><button type="button" disabled={busy} onClick={() => void enter('/api/auth/sign-in/anonymous', {})}>访客进入</button>{error && <div className="notice invalid" role="alert">{error}</div>}</section></main>;
}

function Payments({ output }: { output: SettlementOutput }) {
  return <div className="payment-list">{output.perSeat.map((seat) => <div className="payment-row" key={seat.seatNo}><span>{winds[seat.seatNo]}家</span><strong className={seat.netPoints > 0 ? 'gain' : seat.netPoints < 0 ? 'loss' : ''}>{seat.netPoints > 0 ? '+' : ''}{pointText(seat.netPoints)}</strong><small>{seat.breakdown.map((part) => `${part.reason} ${part.amount > 0 ? '+' : ''}${pointText(part.amount)}`).join(' · ')}</small></div>)}</div>;
}
function RulePreview({ rules }: { rules: TableRules }) {
  const samples = useMemo(() => exampleResults(rules).map((sample) => {
    try { return { title: sample.title, output: calculateSettlement(rulesSnapshot(rules), initialHand(rules), sample.input, ENGINE_VERSION) }; }
    catch { return { title: sample.title, output: null }; }
  }), [rules]);
  return <section className="panel preview-panel"><div className="section-heading"><span>支付预览</span><small>规则示例 · 正式结算以服务端为准</small></div><p className="muted">东一局 · 0 本场 · 无供托 · 无立直。每次修改规则重新计算。</p><div className="sample-grid">{samples.map((sample) => <div className="sample" key={sample.title}><h3>{sample.title}</h3>{sample.output ? <Payments output={sample.output} /> : <p className="notice">示例暂不可计算</p>}</div>)}</div></section>;
}
function NumberField({ label, value, onChange, step = 100, hint }: { label: string; value: number; onChange: (value: number) => void; step?: number; hint?: string }) {
  return <label>{label}<input type="number" inputMode="numeric" step={step} value={value} onChange={(event) => onChange(event.target.value === '' ? NaN : Number(event.target.value))} />{hint && <small>{hint}</small>}</label>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function Create({ localTemplates, addTemplate }: { localTemplates: RuleTemplate[]; addTemplate: (template: RuleTemplate) => void }) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<ServerTemplate[] | null>(null);
  const [chosen, setChosen] = useState<{ name: string; versionId?: string } | null>(null);
  const [rules, setRules] = useState<TableRules | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api<ServerTemplate[]>('/api/rulesets/templates').then((data) => {
      if (alive) setTemplates(data.map((template) => ({
        ...template,
        scope: ['system', 'global', 'public'].includes(template.scope) ? 'system' : 'mine',
      })));
    }).catch((cause: unknown) => { if (alive) setError(errorText(cause)); });
    return () => { alive = false; };
  }, []);
  const change = (patch: Partial<TableRules>) => setRules((current) => current ? { ...current, ...patch } : current);
  function select(name: string, config: TableRules, versionId?: string) {
    setChosen({ name, versionId }); setRules({ ...config, uma: [...config.uma] }); setSaved(''); setError('');
  }
  async function create(config?: TableRules, versionId?: string) {
    setBusy(true); setError('');
    try {
      const { match } = await post<{ match: { id: string; inviteCode: string; status: string } }>('/api/matches', config ? { config } : { rulesetVersionId: versionId });
      navigate(`/table/${match.id}`);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  const validation = rules ? rulesError(rules) : null;
  return <main className="page"><p className="eyebrow">NEW TABLE / 开桌</p><h1>开一桌好牌</h1><div className="steps"><span className={!rules ? 'active' : ''}>01 选模板</span><span className={rules ? 'active' : ''}>02 调规则与预览</span><span>03 入桌签到</span></div>
    {!rules && <><div className="section-heading"><span>预置模板</span><small>服务端模板 · 只读起点</small></div>{!templates && !error && <p className="muted">正在加载模板…</p>}<div className="template-grid">{templates?.filter((template) => template.scope !== 'mine').map((template) => <article className="template" key={template.versionId}><div className="template-top"><span className="tag">{template.config.playerCount} 麻</span><span className="tag muted-tag">{reviewLabels[template.reviewStatus] ?? template.reviewStatus}</span></div><h2>{template.name}</h2><p>{kindLabels[template.kind] ?? template.kind} · {template.templateKey}</p><button type="button" onClick={() => select(template.name, template.config, template.versionId)}>以此为起点调整 →</button><button type="button" className="quiet" disabled={busy} onClick={() => void create(undefined, template.versionId)}>直接应用</button></article>)}</div><div className="section-heading" id="templates"><span>我的模板</span><small>服务端与本地会话</small></div><div className="template-grid">{templates?.filter((template) => template.scope === 'mine').map((template) => <article className="template" key={template.versionId}><span className="tag">{reviewLabels[template.reviewStatus] ?? template.reviewStatus}</span><h2>{template.name}</h2><button type="button" onClick={() => select(template.name, template.config, template.versionId)}>以此为起点调整 →</button><button type="button" className="quiet" disabled={busy} onClick={() => void create(undefined, template.versionId)}>直接应用</button></article>)}{localTemplates.map((template) => <article className="template" key={template.id}><span className="tag">本地 · 登录后同步</span><h2>{template.name}</h2><p>{template.difference}</p><button type="button" onClick={() => select(template.name, template.rules)}>以此为起点调整 →</button></article>)}</div>{templates && !templates.some((template) => template.scope === 'mine') && !localTemplates.length && <div className="empty">尚无我的模板。调整模板后可在当前会话中另存。</div>}</>}
    {rules && <><div className="section-heading"><span>{chosen?.name} · 调整副本</span><button type="button" className="text-button" onClick={() => { setRules(null); setError(''); }}>重新选模板</button></div><p className="muted">模板只读；当前修改仅用于本桌。人数固定，切换人数请另选模板。立直棒固定 1,000 点。</p><div className="rule-layout"><div className="panel rules-form"><h2>比赛与局次</h2><div className="field-grid"><NumberField label="起始点" value={rules.startingPoints} onChange={(startingPoints) => change({ startingPoints })} /><NumberField label="返还点" value={rules.returnPoints} onChange={(returnPoints) => change({ returnPoints })} /><NumberField label="终局目标点" value={rules.endTarget} onChange={(endTarget) => change({ endTarget })} /><label>场次<select value={rules.roundLength} onChange={(event) => change({ roundLength: event.target.value as TableRules['roundLength'], maxRounds: Math.max(rules.maxRounds, event.target.value === 'east' ? 4 : 8) })}><option value="east">东风</option><option value="south">半庄</option></select></label><NumberField label="延长上限（局）" value={rules.maxRounds} step={1} onChange={(maxRounds) => change({ maxRounds })} /></div><div className="field-grid uma-grid">{rules.uma.map((value, i) => <NumberField key={i} label={`${i + 1} 位马点`} value={value} step={1} onChange={(next) => change({ uma: rules.uma.map((v, n) => n === i ? next : v) })} />)}</div><p className="rule-detail">头名赏：{oka(rules)} 竞技分（由起始点、返还点和马点自动得出；竞技分总和归零）</p><h2>局内支付</h2><div className="field-grid"><NumberField label="荒牌流局罚符总额" value={rules.ryuukyokuPoolTotal} onChange={(ryuukyokuPoolTotal) => change({ ryuukyokuPoolTotal })} /><NumberField label="本场 · 每位付款额" value={rules.honbaPerPayer} onChange={(honbaPerPayer) => change({ honbaPerPayer })} hint={`荣和总额 ${pointText(rules.honbaPerPayer * (rules.playerCount - 1))} / 本；自摸每位付款同额`} /></div><h2>支持的开关</h2><div className="switch-grid"><Toggle label="飞人结束（负分）" checked={rules.bustEndsMatch} onChange={(bustEndsMatch) => change({ bustEndsMatch })} /><Toggle label="末局庄家满足目标点且独占第一可结束" checked={rules.dealerFinish} onChange={(dealerFinish) => change({ dealerFinish })} /><Toggle label="食断" checked={rules.openTanyao} onChange={(openTanyao) => change({ openTanyao })} /><Toggle label="切上满贯" checked={rules.kiriageMangan} onChange={(kiriageMangan) => change({ kiriageMangan })} /><Toggle label="累计役满（13 番起）" checked={rules.kazoeYakuman} onChange={(kazoeYakuman) => change({ kazoeYakuman })} /><Toggle label="双响成立" checked={rules.doubleRon} onChange={(doubleRon) => change({ doubleRon })} />{rules.playerCount === 3 && <Toggle label="三麻自摸损" checked={rules.sanmaTsumoLoss} onChange={(sanmaTsumoLoss) => change({ sanmaTsumoLoss })} />}</div><div className="field-grid"><NumberField label="赤宝牌枚数" value={rules.redFives} step={1} onChange={(redFives) => change({ redFives })} /></div><p className="note">包牌、流局满贯及自动诈和罚符未开放。参考模板不可视为来源方的兼容规则。</p></div><aside className="rule-side"><div className="panel"><h3>本桌规则摘要</h3><p>{rules.playerCount} 麻 · {rules.roundLength === 'east' ? '东风' : '半庄'} · {pointText(rules.startingPoints)} 起 / {pointText(rules.returnPoints)} 返</p><p>流局 {pointText(rules.ryuukyokuPoolTotal)} · 本场每付款者 {pointText(rules.honbaPerPayer)}</p></div></aside></div>{validation && <div className="notice invalid" role="alert">{validation}</div>}{!validation && <RulePreview rules={rules} />}<div className="sticky-actions"><div><p>另存仅在本次浏览器会话有效；登录后同步尚未开放。</p><input aria-label="新模板名称" placeholder="新模板名称（另存时填写）" value={templateName} maxLength={40} onChange={(event) => setTemplateName(event.target.value)} />{saved && <small role="status">{saved}</small>}</div><button type="button" disabled={!!validation || busy} onClick={() => void create(rules)}>仅用于本桌 →</button><button type="button" className="primary" disabled={!!validation || !templateName.trim()} onClick={() => { const name = templateName.trim(); addTemplate({ id: crypto.randomUUID(), name, source: '我的模板 · 本地会话', difference: `${rules.playerCount} 麻 · ${pointText(rules.startingPoints)} 起 / ${pointText(rules.returnPoints)} 返`, rules: { ...rules, uma: [...rules.uma] } }); setSaved(`「${name}」已保存在当前会话；登录后同步尚未开放。`); setTemplateName(''); }}>另存为我的模板</button></div></>}
    {error && <div className="notice invalid" role="alert">{error}</div>}
  </main>;
}

function CheckIn() {
  const { matchId } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [seat, setSeat] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitted = useRef<string | null>(null);
  async function checkIn() {
    if (!token || !matchId) return;
    setBusy(true);
    setError('');
    try {
      const result = await post<{ seat: { seatNo: number }; grantId: string }>(`/api/matches/${encodeURIComponent(matchId)}/check-ins`, { token });
      const cleaned = new URL(window.location.href);
      cleaned.searchParams.delete('token');
      window.history.replaceState(window.history.state, '', `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
      setSeat(result.seat.seatNo);
    } catch (cause) {
      setError(cause instanceof ApiError && [400, 404, 410, 422].includes(cause.status)
        ? `签到令牌无效或已过期：${errorText(cause)}` : errorText(cause));
    }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!token || !matchId || submitted.current === `${matchId}:${token}`) return;
    submitted.current = `${matchId}:${token}`;
    void checkIn();
  }, [matchId, token]);
  return <main className="page narrow">
    <p className="eyebrow">CHECK IN / 签到</p><h1>确认入座</h1>
    <section className="panel">
      {!token && <div className="notice invalid" role="alert">签到链接缺少令牌，请重新扫码。</div>}
      {busy && <p className="muted">正在签到…</p>}
      {seat !== null && <><h2>已签到</h2><p>分配座位：{winds[seat] ?? seat + 1}家 · 座位 {seat + 1}</p><Link className="button primary" to={`/table/${matchId}`}>查看牌桌 →</Link></>}
      {error && <><div className="notice invalid" role="alert">签到失败：{error}</div><button type="button" disabled={busy} onClick={() => void checkIn()}>重试签到</button></>}
    </section>
  </main>;
}

function Protected({ principal, children }: { principal: Principal | null; children: React.ReactNode }) {
  const location = useLocation();
  const returnTo = location.pathname.startsWith('/checkin/') ?
    `?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}` : '';
  return principal ? <>{children}</> : <Navigate to={`/login${returnTo}`} replace />;
}
function LoginRoute({ principal, onAuthenticated, onLogout }: { principal: Principal | null; onAuthenticated: (value: Principal) => void; onLogout: () => void }) {
  const [params] = useSearchParams();
  if (!principal) return <Login onAuthenticated={onAuthenticated} />;
  if (params.has('returnTo')) return <Navigate to={checkInReturnTo(params.get('returnTo'))} replace />;
  return <main className="page narrow"><p className="eyebrow">ACCOUNT / 账户</p><h1>我的雀卓</h1><section className="panel"><h2>{principal.displayName}</h2><p className="muted">账户与牌局记录</p><Link className="button" to="/history">查看战绩 →</Link><p><button type="button" className="text-button" onClick={onLogout}>退出登录</button></p></section></main>;
}

export default function App() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [localTemplates, setLocalTemplates] = useState<RuleTemplate[]>([]);
  useEffect(() => {
    let alive = true;
    api<{ principal: Principal }>('/api/me').then(({ principal: me }) => { if (alive) setPrincipal(me); }).catch((cause: unknown) => { if (alive && !(cause instanceof ApiError && cause.status === 401)) setAuthError(errorText(cause)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  async function logout() {
    try { await post('/api/auth/sign-out'); clearNativeAuthToken(); setPrincipal(null); window.location.assign('/login'); }
    catch (cause) { setAuthError(errorText(cause)); }
  }
  return <BrowserRouter><Shell principal={principal}>
    {loading ? <main className="page">正在验证身份…</main> : authError ? <main className="page narrow"><div className="notice invalid" role="alert">身份验证失败：{authError}</div><button type="button" onClick={() => window.location.reload()}>重试</button></main> : <Routes>
      <Route path="/login" element={<LoginRoute principal={principal} onAuthenticated={setPrincipal} onLogout={() => void logout()} />} />
      <Route path="/" element={<Protected principal={principal}><Home templateCount={localTemplates.length} /></Protected>} />
      <Route path="/history" element={<Protected principal={principal}><main className="page"><p className="eyebrow">RECORD / 战绩</p><h1>对局记录</h1><MatchList /></main></Protected>} />
      <Route path="/create" element={<Protected principal={principal}><Create localTemplates={localTemplates} addTemplate={(template) => setLocalTemplates((current) => [...current, template])} /></Protected>} />
      <Route path="/checkin/:matchId" element={<Protected principal={principal}><CheckIn /></Protected>} />
      <Route path="/table/:id" element={<Protected principal={principal}><Table /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>}
  </Shell></BrowserRouter>;
}
