import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { calculateSettlement, ENGINE_VERSION } from '@riichi/engine';
import type { SettlementOutput } from '@riichi/engine';
import { ApiError, api, clearNativeAuthToken, errorText, isNative, post } from './api';
import { canonicalRules, exampleResults, initialHand, matchRulesPayload, pointText, ruleSummary, rulesError, rulesSnapshot, snapshotRuleSummary, winds } from './rules';
import type { TableRules } from './rules';
import Table from './Table';
import BottomTabs from './BottomTabs';
import { createLocalMatch, deleteLocalMatch, isLocalId, listLocalMatches, LOCAL_MATCHES_STORAGE_KEY, LOCAL_SEEDS, seedRules } from './localMatches';
import type { LocalMatch } from './localMatches';
import LocalTable from './LocalTable';
import WizardSteps from './WizardSteps';
import RulesAdjustment from './RulesAdjustment';
import Segmented from './Segmented';
import { routeFromExternalUrl } from './deepLinks';
import { checkInRoute, isValidJoinCode, joinCodeError, normalizeJoinCode, resolveJoinCode } from './joinCode';
import './style.css';

type Principal = { id: string; type: 'account' | 'guest'; displayName: string };
type MatchSummary = {
  id: string;
  status: string;
  playerCount: number;
  createdAt: string;
  name?: string;
  rulesSnapshot?: Record<string, unknown>;
  rulesetVersionId?: string;
  hidden?: boolean;
  isOwner?: boolean;
};
const kindLabels: Record<string, string> = { '4p': '四麻', '3p': '三麻' };
type ServerTemplate = { templateId: string; templateKey: string; kind: string; scope: string; versionId: string; name: string; reviewStatus: string; config: TableRules };
const reviewLabels: Record<string, string> = {
  approved: '已审核', pending: '待审核', rejected: '未通过', draft: '草稿',
  verified: '已审核', unreviewed: '待审核', reviewed: '已复核',
};
const matchLabels: Record<string, string> = {
  preparing: '等待座次确认', lobby: '等待座次确认', active: '牌局进行中', in_progress: '牌局进行中', finished: '牌局已结束',
};
const GUEST_MODE = 'ichihime.local-mode';
const ACCOUNT_HINT = 'ichihime.account-session';
let createDraft: { guest: boolean | null; chosen: { name: string; versionId: string; seedKey?: string; base: TableRules } | null; rules: TableRules | null; localNames: string[]; localDealerSeatNo: number } = { guest: null, chosen: null, rules: null, localNames: [], localDealerSeatNo: 0 };

function Shell({ children, principal }: { children: React.ReactNode; principal: Principal | null }) {
  const bridge = (window as Window & { Capacitor?: { getPlatform?: () => string; platform?: string; isNativePlatform?: () => boolean } }).Capacitor;
  return <div className={`app-shell${isNative() ? ' native-shell' : ''}${bridge?.isNativePlatform?.() && (bridge.getPlatform?.() ?? bridge.platform) === 'ios' ? ' ios-native' : ''}`}>
    <header className="topbar"><Link to="/" className="brand"><span className="brand-tile">東</span><span>一姬<span className="brand-sub"> / ICHIHIME</span></span></Link></header>
    {children}
    <footer className="footer">一姬 / ICHIHIME · 线下记分 · {principal ? '牌局数据实时同步' : '本地牌局仅存此设备'} <span>ENGINE {ENGINE_VERSION}</span></footer>
    <BottomTabs signedIn={!!principal} />
  </div>;
}

export function MatchList({
  initialMatches = null,
  initialShowHidden = false,
}: {
  initialMatches?: MatchSummary[] | null;
  initialShowHidden?: boolean;
} = {}) {
  const [matches, setMatches] = useState<MatchSummary[] | null>(initialMatches);
  const [error, setError] = useState('');
  const [templateNames, setTemplateNames] = useState<Record<string, string>>({});
  const [showHidden, setShowHidden] = useState(initialShowHidden);
  const [undoToast, setUndoToast] = useState<{ id: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchMatches = useCallback(async () => {
    if (initialMatches !== null) return;
    try {
      const url = showHidden ? '/api/matches?mine=1&includeHidden=1' : '/api/matches?mine=1';
      const data = await api<MatchSummary[]>(url);
      setMatches(data);
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [showHidden, initialMatches]);

  useEffect(() => {
    if (initialMatches !== null) return;
    void fetchMatches();
  }, [fetchMatches, initialMatches]);

  useEffect(() => {
    let alive = true;
    api<ServerTemplate[]>('/api/rulesets/templates').then((data) => {
      if (alive) setTemplateNames(Object.fromEntries(data.map((template) => [template.versionId, template.name])));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!undoToast) return;
    const timer = window.setTimeout(() => setUndoToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undoToast]);

  const handleDelete = async (matchId: string) => {
    if (!window.confirm('确定删除此牌桌？此操作无法撤销。')) return;
    setBusyId(matchId);
    try {
      await api(`/api/matches/${encodeURIComponent(matchId)}`, { method: 'DELETE' });
      await fetchMatches();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  };

  const handleLeave = async (matchId: string) => {
    if (!window.confirm('确定退出此牌桌？')) return;
    setBusyId(matchId);
    try {
      await post(`/api/matches/${encodeURIComponent(matchId)}/leave`, {});
      await fetchMatches();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  };

  const handleHide = async (matchId: string) => {
    setBusyId(matchId);
    try {
      await post(`/api/matches/${encodeURIComponent(matchId)}/hide`, {});
      setUndoToast({ id: matchId });
      await fetchMatches();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  };

  const handleUnhide = async (matchId: string) => {
    setBusyId(matchId);
    try {
      await post(`/api/matches/${encodeURIComponent(matchId)}/unhide`, {});
      if (undoToast?.id === matchId) setUndoToast(null);
      await fetchMatches();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  };

  return <>
    <div className="history-toolbar">
      <button
        type="button"
        className="text-button"
        aria-pressed={showHidden}
        onClick={() => setShowHidden((v) => !v)}
      >
        显示已隐藏
      </button>
    </div>
    {error && <div className="notice invalid" role="alert">读取战绩失败：{error}</div>}
    {!error && !matches && <p className="muted">正在读取战绩…</p>}
    {matches && (matches.length ? <div className="history-list">{matches.map((match) => {
      const summary = snapshotRuleSummary(match.rulesSnapshot, templateNames[match.rulesetVersionId ?? ''] ?? match.name ?? '规则模板');
      const isUnfinalized = ['preparing', 'lobby'].includes(match.status);
      const isFinished = ['finished', 'completed'].includes(match.status);
      return <div className="history-row" key={match.id}>
        <span className="tile-mini">中</span>
        <div>
          <strong>牌桌 {match.id}</strong>
          <small>{match.playerCount} 麻 · {new Date(match.createdAt).toLocaleString('zh-CN')}</small>
          <small>{summary.title}{summary.changes.length ? ` · ${summary.changes.join('、')}` : ''}</small>
        </div>
        {match.hidden && <span className="tag">已隐藏</span>}
        <b>{matchLabels[match.status] ?? match.status}</b>
        <Link to={`/table/${match.id}`}>查看牌桌 →</Link>
        {match.hidden ? (
          <button type="button" className="text-button" disabled={busyId === match.id} onClick={() => void handleUnhide(match.id)}>取消隐藏</button>
        ) : isUnfinalized && match.isOwner ? (
          <button type="button" className="text-button danger" disabled={busyId === match.id} onClick={() => void handleDelete(match.id)}>删除</button>
        ) : isUnfinalized && !match.isOwner ? (
          <button type="button" className="text-button" disabled={busyId === match.id} onClick={() => void handleLeave(match.id)}>移除</button>
        ) : isFinished ? (
          <button type="button" className="text-button" disabled={busyId === match.id} onClick={() => void handleHide(match.id)}>隐藏</button>
        ) : null}
      </div>;
    })}</div> : <div className="empty">暂无对局记录。</div>)}
    {undoToast && <div className="undo-toast" role="status"><span>已隐藏对局记录</span><button type="button" className="text-button" onClick={() => void handleUnhide(undoToast.id)}>撤销</button></div>}
  </>;
}

function LocalMatchList({ lobby = false }: { lobby?: boolean }) {
  const [matches, setMatches] = useState<LocalMatch[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => { try { setMatches(listLocalMatches()); setError(''); } catch (cause) { setMatches([]); setError(errorText(cause)); } };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === LOCAL_MATCHES_STORAGE_KEY || event.key === null)) refresh();
    };
    refresh();
    window.addEventListener('ichihime:local-matches', refresh);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('ichihime:local-matches', refresh); window.removeEventListener('storage', onStorage); };
  }, []);
  return <>{error && <div className="notice invalid" role="alert">读取本地战绩失败：{error}</div>}{!error && (matches.length ? <div className="history-list">{matches.map((match) => {
    const seed = LOCAL_SEEDS.find((item) => item.key === match.seedKey);
    const summary = ruleSummary(match.templateName ?? seed?.name ?? match.name, seed ? seedRules(seed) : null, match.rules);
    return <div className="history-row" key={match.id}><span className="tile-mini">中</span><div><strong>{match.name}</strong><small>{match.rules.playerCount} 麻 · {new Date(match.createdAt).toLocaleString('zh-CN')} · 仅此设备</small><small>{summary.title}{summary.changes.length ? ` · ${summary.changes.join('、')}` : ''}</small></div><span className="tag">本地</span><b>{matchLabels[match.status] ?? match.status}</b><Link to={`/table/${match.id}`}>{lobby && match.status === 'active' ? '继续对局 →' : '查看牌桌 →'}</Link><button type="button" className="text-button" onClick={() => {
      if (!window.confirm(`确定删除「${match.name}」？本地牌局及所有局次记录无法恢复。`)) return;
      try { deleteLocalMatch(match.id); } catch (cause) { setError(errorText(cause)); }
    }}>删除</button></div>;
  })}</div> : <div className="empty">暂无本地对局。<Link to="/create">开一桌 →</Link></div>)}</>;
}

function JoinCodeEntry() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeJoinCode(code);
    if (!isValidJoinCode(normalized)) {
      setError('请输入 6 位有效房间码');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const match = await resolveJoinCode(normalized);
      navigate(checkInRoute(match));
    } catch (cause) {
      setError(joinCodeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel join-code-entry" aria-label="使用房间码加入牌局">
    <h2>输入房间码，加入牌局</h2>
    <p className="muted">向房主索取 6 位房间码，进入玩家签到页。</p>
    <form onSubmit={(event) => void join(event)} noValidate>
      <label htmlFor="join-code-input">房间码</label>
      <div className="join-code-fields">
        <input id="join-code-input" value={code} maxLength={6} inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false}
          placeholder="输入 6 位房间码" aria-invalid={!!error} aria-describedby={error ? 'join-code-error' : undefined}
          onChange={(event) => { setCode(normalizeJoinCode(event.target.value).slice(0, 6)); setError(''); }} disabled={busy} />
        <button className="primary" type="submit" disabled={busy}>{busy ? '正在查找…' : '加入牌局'}</button>
      </div>
      {error && <p id="join-code-error" className="join-code-error" role="alert">{error}</p>}
    </form>
  </section>;
}

function Home({ guest }: { guest: boolean }) {
  return <main className="page"><section className="hero"><div><p className="eyebrow">一姬 / ICHIHIME · 线下日麻记分</p><h1>落座，即开局。</h1><p>从规则到结算，给同桌每一分一个清楚的去处。</p><div className="hero-actions"><Link className="button primary" to="/create">开桌 <span>↗</span></Link></div></div><div className="hero-object" aria-hidden="true"><span>一</span><span>萬</span><small>東 一 局</small></div></section><JoinCodeEntry /><div className="section-heading"><span>桌边入口</span><small>01 / 02</small></div><div className="entry-grid"><Link to="/create" className="entry"><b>01</b><h2>开桌</h2><p>选规则，调数值，预览支付。</p><span>建立牌局 →</span></Link><Link to="/history" className="entry"><b>02</b><h2>战绩</h2><p>对局历史与成绩入口。</p><span>查看战绩 →</span></Link></div><div className="section-heading" id="战绩"><span>{guest ? '本地牌局' : '战绩'}</span><Link to="/history">查看全部 →</Link></div>{guest ? <LocalMatchList lobby /> : <MatchList />}</main>;
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
  return <main className="page narrow"><p className="eyebrow">ACCOUNT / 账户</p><h1>登录一姬</h1><section className="panel"><Segmented label="登录方式" value={mode} options={[{ value: 'login', label: '邮箱登录' }, { value: 'register', label: '注册账户' }]} onChange={setMode} /><form onSubmit={(event) => { event.preventDefault(); void enter(mode === 'login' ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email', mode === 'login' ? { email, password } : { email, password, name }); }}>{mode === 'register' && <label>昵称<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>}<label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label><button className="primary" type="submit" disabled={busy}>{mode === 'login' ? '登录' : '注册并登录'}</button></form><p className="note">无需邮箱？访客签到需由桌主预先批准座位，并使用获批准的同一身份。</p><button type="button" disabled={busy} onClick={() => void enter('/api/auth/sign-in/anonymous', {})}>访客进入</button>{error && <div className="notice invalid" role="alert">{error}</div>}</section></main>;
}

function Payments({ output }: { output: SettlementOutput }) {
  return <div className="payment-list">{output.perSeat.map((seat) => <div className="payment-row" key={seat.seatNo}><span>{winds[seat.seatNo]}家</span><strong className={seat.netPoints > 0 ? 'gain' : seat.netPoints < 0 ? 'loss' : ''}>{seat.netPoints > 0 ? '+' : ''}{pointText(seat.netPoints)}</strong><small>{seat.breakdown.map((part) => `${part.reason} ${part.amount > 0 ? '+' : ''}${pointText(part.amount)}`).join(' · ')}</small></div>)}</div>;
}
function RulePreview({ rules, guest }: { rules: TableRules; guest: boolean }) {
  const samples = useMemo(() => exampleResults(rules).map((sample) => {
    try { return { title: sample.title, output: calculateSettlement(rulesSnapshot(rules), initialHand(rules), sample.input, ENGINE_VERSION) }; }
    catch { return { title: sample.title, output: null }; }
  }), [rules]);
  return <section className="panel preview-panel"><div className="section-heading"><span>支付预览</span><small>规则示例 · {guest ? '本地结算由内置引擎计算' : '正式结算以服务端为准'}</small></div><p className="muted">东一局 · 0 本场 · 无供托 · 无立直。每次修改规则重新计算。</p><div className="sample-grid">{samples.map((sample) => <div className="sample" key={sample.title}><h3>{sample.title}</h3>{sample.output ? <Payments output={sample.output} /> : <p className="notice">示例暂不可计算</p>}</div>)}</div></section>;
}

function Create({ guest }: { guest: boolean }) {
  const [templates, setTemplates] = useState<ServerTemplate[] | null>(null);
  const [chosen, setChosen] = useState<typeof createDraft.chosen>(() => createDraft.guest === guest ? createDraft.chosen : null);
  const [rules, setRules] = useState<TableRules | null>(() => createDraft.guest === guest ? createDraft.rules : null);
  const [step, setStep] = useState<1 | 2 | 3>(() => createDraft.guest === guest && createDraft.rules ? 2 : 1);
  const [localNames, setLocalNames] = useState<string[]>(() => createDraft.guest === guest ? createDraft.localNames : []);
  const [localDealerSeatNo, setLocalDealerSeatNo] = useState(() => createDraft.guest === guest ? createDraft.localDealerSeatNo : 0);
  const [created, setCreated] = useState<{ id: string; template: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (guest) {
      setTemplates(LOCAL_SEEDS.map((seed) => ({
        templateId: seed.key, templateKey: seed.key, kind: `${seed.config.playerCount}p`, scope: 'system',
        versionId: seed.key, name: seed.name, reviewStatus: seed.reviewStatus, config: seedRules(seed),
      })));
      return;
    }
    let alive = true;
    api<ServerTemplate[]>('/api/rulesets/templates').then((data) => {
      if (alive) setTemplates(data.map((template) => ({
        ...template, config: canonicalRules(template.config),
        scope: ['system', 'global', 'public'].includes(template.scope) ? 'system' : 'mine',
      })));
    }).catch((cause: unknown) => { if (alive) setError(errorText(cause)); });
    return () => { alive = false; };
  }, [guest]);
  useEffect(() => { createDraft = { guest, chosen, rules, localNames, localDealerSeatNo }; }, [guest, chosen, rules, localNames, localDealerSeatNo]);
  function select(template: ServerTemplate) {
    setCreated(null);
    const base = template.config;
    setChosen({ name: template.name, versionId: template.versionId,
      seedKey: guest ? template.versionId : undefined, base });
    setRules({ ...base, uma: [...base.uma] });
    setLocalNames(Array.from({ length: base.playerCount }, (_, seatNo) => `玩家 ${seatNo + 1}`));
    setLocalDealerSeatNo(0);
    setError(''); setStep(2);
  }
  async function create(template?: ServerTemplate) {
    if (!template && (!chosen || !rules)) return;
    if (template) setCreated(null);
    const selected = template ? template.config : rules!;
    const source = template ? { name: template.name, versionId: template.versionId, seedKey: guest ? template.versionId : undefined,
      base: selected } : chosen!;
    const validation = rulesError(selected);
    if (validation) { setError(validation); return; }
    setBusy(true); setError('');
    try {
      if (guest) {
        const match = createLocalMatch(selected, source.name, source.seedKey ?? null,
          { playerNames: Array.from({ length: selected.playerCount }, (_, seatNo) => localNames[seatNo] ?? `玩家 ${seatNo + 1}`),
            dealerSeatNo: localDealerSeatNo });
        setCreated({ id: match.id, template: source.name });
      } else {
        const { match } = await post<{ match: { id: string } }>('/api/matches',
          matchRulesPayload(source.versionId, source.base, selected));
        setCreated({ id: match.id, template: source.name });
      }
      if (template) { setChosen(source); setRules({ ...selected, uma: [...selected.uma] }); }
      setStep(3);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  const validation = rules ? rulesError(rules) : null;
  return <main className="page"><p className="eyebrow">NEW TABLE / 开桌</p><h1>开一桌好牌</h1>
    <WizardSteps step={step} unlocked={created ? 3 : rules ? 2 : 1} onStep={setStep} guest={guest} />
    {step === 1 && <><div className="section-heading"><span>预置模板</span><small>{guest ? '内置模板 · 离线可用' : '服务端模板 · 只读起点'}</small></div>
      {!templates && !error && <p className="muted">正在加载模板…</p>}
      <div className="template-grid">{templates?.filter((template) => template.scope !== 'mine').map((template) =>
        <article className="template" key={template.versionId}><div className="template-top"><span className="tag">{template.config.playerCount} 麻</span><span className="tag muted-tag">{reviewLabels[template.reviewStatus] ?? template.reviewStatus}</span></div>
          <h2>{template.name}</h2><p>{kindLabels[template.kind] ?? template.kind} · {template.templateKey}</p>
          <button type="button" onClick={() => select(template)}>以此为起点调整 →</button>
          <button type="button" className="quiet" disabled={busy} onClick={() => guest ? select(template) : void create(template)}>{guest ? '设置玩家与起家 →' : '直接应用'}</button>
        </article>)}</div>
    </>}
    {step === 2 && chosen && rules && <><div className="section-heading"><span>{chosen.name} · 本桌规则</span><button type="button" className="text-button" onClick={() => { setStep(1); setError(''); }}>重新选模板</button></div>
      <RulesAdjustment key={chosen.versionId} base={chosen.base} rules={rules} onChange={(adjusted) => { setCreated(null); setRules(adjusted); }} />
      {guest && <section className="panel local-setup"><div className="section-heading"><span>本地玩家与起家</span><small>开局前设置，默认座位 1 为东家</small></div>
        <div className="member-list">{Array.from({ length: rules.playerCount }, (_, seatNo) => <div key={seatNo}><span className="wind-badge">{seatNo + 1}</span>
          <label>座位 {seatNo + 1}<input aria-label={`座位 ${seatNo + 1} 玩家姓名`} maxLength={40} value={localNames[seatNo] ?? `玩家 ${seatNo + 1}`} onChange={(event) => {
            setCreated(null);
            setLocalNames((names) => { const updated = [...names]; updated[seatNo] = event.target.value; return updated; });
          }} /></label>
          <label className="toggle">起家（东家）<input type="radio" name="local-dealer" checked={localDealerSeatNo === seatNo} onChange={() => { setCreated(null); setLocalDealerSeatNo(seatNo); }} /></label>
        </div>)}</div>
      </section>}
      {validation && <div className="notice invalid" role="alert">{validation}</div>}
      {!validation && <RulePreview rules={rules} guest={guest} />}
      <div className="sticky-actions"><p>模板只读；调整后的完整规则随本桌保存。</p><button type="button" className="primary" disabled={!!validation || busy} onClick={() => void create()}>{guest ? '创建本地对局 →' : '仅用于本桌 →'}</button></div>
    </>}
    {step === 3 && created && <section className="panel">
      <p className="eyebrow">{guest ? 'LOCAL TABLE / 本地对局' : 'TABLE READY / 入桌签到'}</p>
      <h2>{created.template} · 已开桌</h2>
      <p className="muted">{guest ? '牌局已保存在此设备。进入牌桌即可记分，无需签到或联网。' : '牌局已创建。进入牌桌继续座次确认与签到。'}</p>
      <Link className="button primary" to={`/table/${created.id}`}>{guest ? '进入本地牌桌 →' : '入桌签到 →'}</Link>
    </section>}
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
      setError(cause instanceof ApiError && cause.code === 'check_in_not_approved'
        ? '桌主尚未批准您的座位。请确认使用获批准的账户，待桌主确认后使用有效签到链接重试。'
        : cause instanceof ApiError && [400, 404, 410, 422].includes(cause.status)
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
function LoginRoute({ principal, onAuthenticated, onLogout, logoutError }: { principal: Principal | null; onAuthenticated: (value: Principal) => void; onLogout: () => void; logoutError: string }) {
  const [params] = useSearchParams();
  if (!principal) return <Login onAuthenticated={onAuthenticated} />;
  if (params.has('returnTo')) return <Navigate to={checkInReturnTo(params.get('returnTo'))} replace />;
  return <main className="page narrow"><p className="eyebrow">ACCOUNT / 账户</p><h1>我的一姬</h1><section className="panel"><h2>{principal.displayName}</h2><p className="muted">账户与牌局记录</p><Link className="button" to="/history">查看战绩 →</Link><p><button type="button" className="text-button" onClick={onLogout}>退出登录</button></p>{logoutError && <div className="notice invalid" role="alert">退出登录失败：{logoutError}，请重试。</div>}</section></main>;
}

function TableRoute({ principal }: { principal: Principal | null }) {
  const { id } = useParams();
  if (isLocalId(id)) return <LocalTable />;
  return <Protected principal={principal}><Table /></Protected>;
}

function GuestChoice({ onLocal }: { onLocal: () => void }) {
  return <main className="page narrow"><p className="eyebrow">WELCOME / 欢迎</p><h1>选择入桌方式</h1>
    <section className="panel"><h2>在此设备离线记分</h2><p className="muted">不需要账户或网络。牌局仅保存在当前浏览器；清除浏览器数据后无法恢复。</p>
      <button type="button" className="primary" onClick={onLocal}>继续本地模式 →</button></section>
    <section className="panel"><h2>已有账户？</h2><p className="muted">先检查现有登录状态，继续使用账户牌局及云端战绩。</p>
      <a className="button" href="/login">检查账户 / 登录 →</a></section>
  </main>;
}

function NativeDeepLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let opened = false;
    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      if (!active) return;
      const route = routeFromExternalUrl(url);
      if (route) { opened = true; navigate(route); }
    });
    void CapacitorApp.getLaunchUrl().then((launch) => {
      if (!active || opened || !launch?.url) return;
      const route = routeFromExternalUrl(launch.url);
      if (route) navigate(route);
    });
    return () => {
      active = false;
      void listener.then((handle) => handle.remove());
    };
  }, [navigate]);
  return null;
}

export default function App() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [guestMode, setGuestMode] = useState(() => localStorage.getItem(GUEST_MODE) === '1');
  useEffect(() => {
    // An older browser may have an HttpOnly account cookie without our local
    // hint. Show the explicit mode choice instead of silently treating it as guest.
    const path = window.location.pathname;
    const hasSession = localStorage.getItem(ACCOUNT_HINT) === '1' ||
      (isNative() && !!localStorage.getItem('riichi.native.auth-token'));
    if (!navigator.onLine || (guestMode && path !== '/login' && !path.startsWith('/checkin/')) ||
      (!hasSession && path !== '/login' && !path.startsWith('/checkin/'))) {
      setLoading(false);
      return;
    }
    let alive = true;
    api<{ principal: Principal }>('/api/me').then(({ principal: me }) => {
      if (alive) { setPrincipal(me); localStorage.setItem(ACCOUNT_HINT, '1'); localStorage.removeItem(GUEST_MODE); setGuestMode(false); }
    }).catch((cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) localStorage.removeItem(ACCOUNT_HINT);
      else if (alive) setAuthError(errorText(cause));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  function enterLocalMode() {
    localStorage.setItem(GUEST_MODE, '1');
    window.dispatchEvent(new Event('ichihime:local-mode'));
    setGuestMode(true);
    setAuthError('');
  }
  async function logout() {
    setLogoutError('');
    try { await post('/api/auth/sign-out'); }
    catch (cause) {
      // An offline native sign-out cannot revoke the server session, but must still
      // discard the local bearer so the next launch cannot silently sign back in.
      if (!isNative()) { setLogoutError(errorText(cause)); return; }
    }
    clearNativeAuthToken();
    localStorage.removeItem(ACCOUNT_HINT);
    setPrincipal(null);
    window.location.assign('/login');
  }
  return <BrowserRouter><NativeDeepLinks /><Shell principal={principal}>
    {loading ? <main className="page">正在验证身份…</main> : authError ? <main className="page narrow"><div className="notice invalid" role="alert">身份验证失败：{authError}</div><button type="button" onClick={() => window.location.reload()}>重试</button><button type="button" onClick={enterLocalMode}>改用本地模式</button></main> : !principal && !guestMode ? <Routes>
      <Route path="/login" element={<LoginRoute principal={principal} onAuthenticated={(value) => { localStorage.setItem(ACCOUNT_HINT, '1'); localStorage.removeItem(GUEST_MODE); setGuestMode(false); setPrincipal(value); }} onLogout={() => void logout()} logoutError={logoutError} />} />
      <Route path="/checkin/:matchId" element={<Protected principal={principal}><CheckIn /></Protected>} />
      <Route path="*" element={<GuestChoice onLocal={enterLocalMode} />} />
    </Routes> : <Routes>
      <Route path="/login" element={<LoginRoute principal={principal} onAuthenticated={(value) => { localStorage.setItem(ACCOUNT_HINT, '1'); localStorage.removeItem(GUEST_MODE); setGuestMode(false); setPrincipal(value); }} onLogout={() => void logout()} logoutError={logoutError} />} />
      <Route path="/" element={<Home guest={!principal} />} />
      <Route path="/history" element={<main className="page"><p className="eyebrow">RECORD / 战绩</p><h1>对局记录</h1>{principal ? <MatchList /> : <LocalMatchList />}</main>} />
      <Route path="/create" element={<Create guest={!principal} />} />
      <Route path="/checkin/:matchId" element={<Protected principal={principal}><CheckIn /></Protected>} />
      <Route path="/table/:id" element={<TableRoute principal={principal} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>}
  </Shell></BrowserRouter>;
}
