import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, post } from '../api';
import { errorTextZh } from '../errors';
import { shareUrl } from '../joinCode';
import type { MatchView, Me } from '../types';
import { formatDate, MODE_LABEL, STATUS_LABEL } from '../types';
import { CopyButton, FinalScoreTable, memberName, Notice, WindTile } from './ui';
import FinalScoresEditor from './FinalScoresEditor';
import type { EditorMode } from './FinalScoresEditor';

export default function TablePage({ me }: { me: Me }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<MatchView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(false);

  const fetchView = useCallback(async () => {
    try {
      const data = await api<MatchView>(`/api/matches/${encodeURIComponent(id ?? '')}`);
      setView(data);
      setError('');
    } catch (cause) {
      setError(errorTextZh(cause));
    }
  }, [id]);

  useEffect(() => { void fetchView(); }, [fetchView]);

  useEffect(() => { setCorrecting(false); }, [id]);

  const status = view?.status;
  useEffect(() => {
    if (status !== 'waiting' && status !== 'in_progress') return;
    const timer = window.setInterval(() => { void fetchView(); }, 4000);
    const onFocus = () => { void fetchView(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [status, fetchView]);

  async function cancel() {
    if (!view || !window.confirm('确定取消本场？取消后无法恢复。')) return;
    setBusy(true);
    try {
      const data = await post<MatchView>(`/api/matches/${encodeURIComponent(view.id)}/cancel`, {});
      setView(data);
    } catch (cause) {
      setError(errorTextZh(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!view || !window.confirm('确定删除本场？此操作无法撤销。')) return;
    setBusy(true);
    try {
      await api(`/api/admin/matches/${encodeURIComponent(view.id)}`, { method: 'DELETE' });
      navigate('/history');
    } catch (cause) {
      setError(errorTextZh(cause));
    } finally {
      setBusy(false);
    }
  }

  if (error && !view) return <main className="page narrow"><Notice invalid>{error}</Notice>
    <p><Link className="text-button" to="/">回大厅 →</Link></p></main>;
  if (!view) return <main className="page narrow"><p className="muted">正在读取牌桌…</p></main>;

  const isHost = me.principal.id === view.hostId;
  const isAdmin = me.isAdmin;
  const total = view.mode === '3p' ? 3 : 4;
  const seats = [...view.seats].sort((a, b) => a.seatNo - b.seatNo);
  const editorMode: EditorMode = isHost ? 'correct' : 'admin-correct';

  return <main className="page table-page">
    <p className="eyebrow">TABLE / 牌桌</p>
    <div className="table-heading">
      <h1>{MODE_LABEL[view.mode]} · {STATUS_LABEL[view.status]}</h1>
      <span className="tag">{formatDate(view.createdAt)}开局</span>
    </div>
    {error && <Notice invalid>{error}</Notice>}

    {view.status === 'waiting' && <section className="panel">
      <h2>等待人齐 · 成员 {view.members.length} / {total}</h2>
      <div className="member-list">{view.members.map((member) => <div key={member.userId}>
        <span className="ellipsis member-identity"><span className="member-name">{member.displayName}</span>{member.isHost && <small className="tag">房主</small>}{member.userId === me.principal.id && <span className="member-self">· 我</span>}</span>
      </div>)}</div>
      <p className="muted">人齐后系统直接随机分座，东座即庄家，座次锁定。</p>
      <div className="share-code-block">
        <small>房间码</small>
        <strong>{view.joinCode ?? '—'}</strong>
        {view.joinCode && <CopyButton text={view.joinCode} label="复制房间码" />}
        {view.joinCode && <CopyButton text={shareUrl(view.id, view.joinCode)} label="复制链接" />}
        <Link className="text-button" to={`/share/${view.id}`}>分享页（含二维码）→</Link>
      </div>
      {isHost && <button type="button" className="text-button danger" disabled={busy} onClick={() => void cancel()}>取消本场</button>}
    </section>}

    {view.status === 'in_progress' && <section className="panel">
      <h2>本场进行中 · 座次已锁定</h2>
      <div className="member-list">{seats.map((seat) => <div key={seat.seatNo}>
        <WindTile wind={seat.wind ?? ''} />
        <span className="ellipsis member-identity"><span className="member-name">{memberName(view, seat.userId)}</span>{seat.seatNo === 0 && <small className="tag">庄家</small>}{seat.userId === me.principal.id && <span className="member-self">· 我</span>}</span>
        <small>{seat.wind ? `座位 ${seat.seatNo + 1}` : ''}</small>
      </div>)}</div>
      {isHost
        ? <FinalScoresEditor key={view.id} match={view} mode="record" onSaved={(next) => setView(next)} />
        : <Notice>等待房主记终局得点。终局得点由房主填写，其他人只读。</Notice>}
      {isHost && <button type="button" className="text-button danger" disabled={busy} onClick={() => void cancel()}>取消本场</button>}
    </section>}

    {view.status === 'finished' && <section className="panel">
      <h2>终局得点</h2>
      <FinalScoreTable view={view} />
      {view.correctedAt && <p className="note">已于 {formatDate(view.correctedAt)} 纠正过。</p>}
      {(isHost || isAdmin) && !correcting && <button type="button" className="primary" onClick={() => setCorrecting(true)}>纠正终局得点</button>}
      {(isHost || isAdmin) && correcting && <FinalScoresEditor key={view.id} match={view} mode={editorMode} onSaved={(next) => { setView(next); setCorrecting(false); }} />}
      {isAdmin && <button type="button" className="text-button danger" disabled={busy} onClick={() => void remove()}>删除本场</button>}
    </section>}

    {view.status === 'cancelled' && <section className="panel">
      <h2>本场已取消</h2>
      <p className="muted">房主取消了本场。如需重开，请回大厅新建一桌。</p>
      <Link className="button primary" to="/create">重新开桌 →</Link>
    </section>}

    <p><Link className="text-button" to="/">回大厅 →</Link> <Link className="text-button" to="/history">查看战绩 →</Link></p>
  </main>;
}
