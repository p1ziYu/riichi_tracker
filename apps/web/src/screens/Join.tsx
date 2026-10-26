import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { errorTextZh } from '../errors';
import { isValidJoinCode, normalizeJoinCode, resolveJoinCode } from '../joinCode';
import { Notice } from './ui';

// /checkin/:matchId is now a direct-join redirect, not a check-in page:
// a token (signed token, or the room code in ?token=) admits immediately.
export default function Join() {
  const { matchId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current || !matchId) return;
    attempted.current = true;
    setBusy(true);
    post(`/api/matches/${encodeURIComponent(matchId)}/join`, { token }).then(() => {
      navigate(`/table/${encodeURIComponent(matchId)}`, { replace: true });
    }).catch((cause) => {
      setError(errorTextZh(cause));
      setBusy(false);
    });
  }, [token, matchId, navigate]);

  async function joinByCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeJoinCode(code);
    if (!isValidJoinCode(normalized)) {
      setError('请输入 6 位有效房间码');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const resolved = await resolveJoinCode(normalized);
      await post(`/api/matches/${encodeURIComponent(resolved.matchId)}/join`, { token: resolved.token });
      navigate(`/table/${encodeURIComponent(resolved.matchId)}`);
    } catch (cause) {
      setError(errorTextZh(cause));
    } finally {
      setBusy(false);
    }
  }

  return <main className="page narrow">
    <p className="eyebrow">JOIN / 加入牌桌</p>
    <h1>加入牌桌</h1>
    <section className="panel">
      {token && busy && <p className="muted" role="status">正在加入牌桌…</p>}
      {token && !busy && error && <>
        <Notice invalid>{error}</Notice>
        <p className="muted">链接加入失败时，可改用房间码加入，或回大厅从战绩进入已入座的牌桌。</p>
      </>}
      {(!token || (!busy && error)) && <form onSubmit={(event) => void joinByCode(event)} noValidate>
        <label htmlFor="join-code-input-2">房间码</label>
        <div className="join-code-fields">
          <input id="join-code-input-2" value={code} maxLength={6} inputMode="text" autoCapitalize="characters"
            autoComplete="off" spellCheck={false} placeholder="输入 6 位房间码"
            onChange={(event) => { setCode(normalizeJoinCode(event.target.value).slice(0, 6)); setError(''); }} disabled={busy} />
          <button className="primary" type="submit" disabled={busy}>{busy ? '正在加入…' : '加入牌局'}</button>
        </div>
      </form>}
      {error && !token && <Notice invalid>{error}</Notice>}
      <p><Link className="text-button" to="/">回大厅 →</Link></p>
    </section>
  </main>;
}
