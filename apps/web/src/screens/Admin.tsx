import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { errorTextZh } from '../errors';
import type { AdminPlayer, MatchView, Me } from '../types';
import { formatDate, MODE_LABEL, STATUS_LABEL } from '../types';
import { Notice } from './ui';

export default function Admin({ me }: { me: Me }) {
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [matches, setMatches] = useState<MatchView[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [playerData, matchData] = await Promise.all([
        api<{ players: AdminPlayer[] }>('/api/admin/players'),
        api<MatchView[]>('/api/admin/matches'),
      ]);
      setPlayers(playerData.players);
      setMatches(matchData);
      setError('');
    } catch (cause) {
      setError(errorTextZh(cause));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!me.isAdmin) return <main className="page narrow">
    <Notice invalid>需要管理员权限才能查看此页。</Notice>
    <p><Link className="text-button" to="/">回大厅 →</Link></p>
  </main>;

  async function remove(matchId: string) {
    if (!window.confirm('确定删除本场？此操作无法撤销。')) return;
    setBusyId(matchId);
    try {
      await api(`/api/admin/matches/${encodeURIComponent(matchId)}`, { method: 'DELETE' });
      await refresh();
    } catch (cause) {
      setError(errorTextZh(cause));
    } finally {
      setBusyId(null);
    }
  }

  return <main className="page">
    <p className="eyebrow">ADMIN / 管理</p>
    <h1>玩家管理与数据管理</h1>
    <p className="muted">仅管理员可见。纠正终局得点请进入牌桌页（房主或管理员均可纠正）。</p>
    {error && <Notice invalid>{error}</Notice>}

    <div className="section-heading"><span>玩家管理</span></div>
    {!players && !error && <p className="muted">正在读取玩家…</p>}
    {players && (players.length ? <div className="history-list">{players.map((player) => <div className="history-row" key={player.id}>
      <span className="tile-mini">中</span>
      <div><strong className="ellipsis">{player.displayName}</strong><small>参与对局 {player.matchCount} 场</small></div>
    </div>)}</div> : <div className="empty">暂无玩家。</div>)}

    <div className="section-heading"><span>数据管理 · 全部对局</span></div>
    {!matches && !error && <p className="muted">正在读取对局…</p>}
    {matches && (matches.length ? <div className="history-list">{matches.map((match) => <div className="history-row" key={match.id}>
      <span className="tile-mini">中</span>
      <div>
        <strong>{MODE_LABEL[match.mode]} · {formatDate(match.createdAt)}</strong>
        <small>成员 {match.members.length} 人 · {STATUS_LABEL[match.status]}</small>
      </div>
      <Link className="text-button" to={`/table/${match.id}`}>查看 →</Link>
      <button type="button" className="text-button danger" disabled={busyId === match.id} onClick={() => void remove(match.id)}>删除</button>
    </div>)}</div> : <div className="empty">暂无对局。</div>)}
  </main>;
}
