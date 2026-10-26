import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, post } from '../api';
import { errorTextZh } from '../errors';
import { isValidJoinCode, normalizeJoinCode, resolveJoinCode } from '../joinCode';
import type { MatchView } from '../types';
import { formatDate, MODE_LABEL, STATUS_LABEL } from '../types';
import { Notice } from './ui';

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
      await post(`/api/matches/${encodeURIComponent(match.matchId)}/join`, { token: match.token });
      navigate(`/table/${encodeURIComponent(match.matchId)}`);
    } catch (cause) {
      setError(errorTextZh(cause));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel join-code-entry" aria-label="使用房间码加入牌局">
    <h2>输入房间码，加入牌局</h2>
    <p className="muted">向房主索取 6 位房间码，直接加入牌桌，不再经过签到页。</p>
    <form onSubmit={(event) => void join(event)} noValidate>
      <label htmlFor="join-code-input">房间码</label>
      <div className="join-code-fields">
        <input id="join-code-input" value={code} maxLength={6} inputMode="text" autoCapitalize="characters"
          autoComplete="off" spellCheck={false} placeholder="输入 6 位房间码"
          aria-invalid={!!error} aria-describedby={error ? 'join-code-error' : undefined}
          onChange={(event) => { setCode(normalizeJoinCode(event.target.value).slice(0, 6)); setError(''); }} disabled={busy} />
        <button className="primary" type="submit" disabled={busy}>{busy ? '正在查找…' : '加入牌局'}</button>
      </div>
      {error && <p id="join-code-error" className="join-code-error" role="alert">{error}</p>}
    </form>
  </section>;
}

function matchSummary(view: MatchView): string {
  if (view.status === 'finished' && view.finalScores) {
    const ordered = [...view.finalScores].sort((a, b) => a.rank - b.rank);
    const names = ordered.map((entry) => {
      const seat = view.seats.find((item) => item.wind === entry.wind);
      const name = view.members.find((member) => member.userId === seat?.userId)?.displayName ?? '—';
      return `${name} ${entry.score}`;
    });
    return names.join(' · ');
  }
  const count = view.members.length;
  const total = view.mode === '3p' ? 3 : 4;
  return `成员 ${count} / ${total}`;
}

export default function Home() {
  const [matches, setMatches] = useState<MatchView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api<MatchView[]>('/api/matches/mine').then((data) => {
      if (alive) { setMatches(data); setError(''); }
    }).catch((cause) => { if (alive) setError(errorTextZh(cause)); });
    return () => { alive = false; };
  }, []);

  const ongoing = matches?.find((item) => item.status === 'in_progress' || item.status === 'waiting');
  const recent = matches?.slice(0, 5) ?? [];

  return <main className="page">
    <section className="hero">
      <div>
        <p className="eyebrow">一姬 / ICHIHIME · 线下日麻记分</p>
        <h1>记录每一场半庄。</h1>
        <p>选三麻或四麻，人齐随机分座；打完只记终局得点，底下合计一核就知道算没算对。</p>
        <div className="hero-actions">
          <Link className="button primary" to="/create">开桌 <span>↗</span></Link>
          <Link className="button" to="/history">查看战绩</Link>
        </div>
      </div>
      <div className="hero-object" aria-hidden="true"><span>一</span><span>萬</span><small>東 一 局</small></div>
    </section>

    {ongoing && <section className="panel ongoing-card">
      <p className="eyebrow">MATCH IN PROGRESS</p>
      <h2>{ongoing.status === 'in_progress' ? '本场还在进行中' : '本场等待人齐'}</h2>
      <p className="muted">{MODE_LABEL[ongoing.mode]} · {formatDate(ongoing.createdAt)}开局，座次{ongoing.seats.length ? '已锁定' : '待人齐随机分配'}。</p>
      <Link className="button primary" to={`/table/${ongoing.id}`}>继续本场 →</Link>
    </section>}

    <JoinCodeEntry />

    <div className="section-heading"><span>桌边入口</span><small>01 / 02</small></div>
    <div className="entry-grid">
      <Link to="/create" className="entry"><b>01</b><h2>开桌</h2><p>选三麻或四麻，直接开一桌。</p><span>建立牌局 →</span></Link>
      <Link to="/history" className="entry"><b>02</b><h2>战绩</h2><p>自己参与过的对局都在这里。</p><span>查看战绩 →</span></Link>
    </div>

    <div className="section-heading" id="战绩"><span>最近对局</span><Link to="/history">查看全部 →</Link></div>
    {error && <Notice invalid>读取战绩失败：{error}</Notice>}
    {!error && !matches && <p className="muted">正在读取战绩…</p>}
    {matches && (recent.length ? <div className="history-list">{recent.map((match) => <Link className="history-row" key={match.id} to={`/table/${match.id}`}>
      <span className="tile-mini">中</span>
      <div>
        <strong>{MODE_LABEL[match.mode]} · {formatDate(match.createdAt)}</strong>
        <small>{matchSummary(match)}</small>
      </div>
      <b>{STATUS_LABEL[match.status]}</b>
      <span>查看 →</span>
    </Link>)}</div> : <div className="empty">还没有对局记录。<Link to="/create">开一桌 →</Link></div>)}
  </main>;
}
