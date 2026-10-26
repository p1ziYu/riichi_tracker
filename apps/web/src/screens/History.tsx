import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { errorTextZh } from '../errors';
import type { MatchView, Me } from '../types';
import { formatDate, MODE_LABEL, STATUS_LABEL } from '../types';
import { Notice } from './ui';

function summary(view: MatchView): string {
  if (view.status === 'finished' && view.finalScores) {
    const ordered = [...view.finalScores].sort((a, b) => a.rank - b.rank);
    return ordered.map((entry) => {
      const seat = view.seats.find((item) => item.wind === entry.wind);
      const name = view.members.find((member) => member.userId === seat?.userId)?.displayName ?? '—';
      return `${name} ${entry.score}`;
    }).join(' · ');
  }
  const total = view.mode === '3p' ? 3 : 4;
  return `成员 ${view.members.length} / ${total}`;
}

export default function History({ me }: { me: Me }) {
  const [matches, setMatches] = useState<MatchView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api<MatchView[]>('/api/matches/mine').then((data) => {
      if (alive) { setMatches(data); setError(''); }
    }).catch((cause) => { if (alive) setError(errorTextZh(cause)); });
    return () => { alive = false; };
  }, []);

  return <main className="page">
    <p className="eyebrow">RECORD / 战绩</p>
    <h1>对局记录</h1>
    {me.isAdmin && <section className="panel admin-entry">
      <h2>管理入口</h2>
      <p className="muted">你是管理员，可管理全部玩家与对局数据。</p>
      <Link className="button" to="/admin">玩家管理与数据管理 →</Link>
    </section>}
    {error && <Notice invalid>读取战绩失败：{error}</Notice>}
    {!error && !matches && <p className="muted">正在读取战绩…</p>}
    {matches && (matches.length ? <div className="history-list">{matches.map((match) => <Link className="history-row" key={match.id} to={`/table/${match.id}`}>
      <span className="tile-mini">中</span>
      <div>
        <strong>{MODE_LABEL[match.mode]} · {formatDate(match.createdAt)}</strong>
        <small>{summary(match)}</small>
      </div>
      <b>{STATUS_LABEL[match.status]}</b>
      <span>查看 →</span>
    </Link>)}</div> : <div className="empty">还没有对局记录。<Link to="/create">开一桌 →</Link></div>)}
  </main>;
}
