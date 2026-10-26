import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api';
import { errorTextZh } from '../errors';
import { shareUrl } from '../joinCode';
import type { MatchView } from '../types';
import { MODE_LABEL } from '../types';
import { CopyButton, Notice } from './ui';

export default function Share() {
  const { id } = useParams();
  const location = useLocation();
  const stateMatch = (location.state as { match?: MatchView } | null)?.match ?? null;
  const [match, setMatch] = useState<MatchView | null>(stateMatch);
  const [error, setError] = useState('');
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (match) return;
    let alive = true;
    api<MatchView>(`/api/matches/${encodeURIComponent(id ?? '')}`).then((data) => {
      if (alive) setMatch(data);
    }).catch((cause) => { if (alive) setError(errorTextZh(cause)); });
    return () => { alive = false; };
  }, [id, match]);

  const code = match?.joinCode ?? '';
  const link = match && code ? shareUrl(match.id, code) : '';

  useEffect(() => {
    if (!link) return;
    let alive = true;
    QRCode.toDataURL(link, { width: 260, margin: 2, color: { dark: '#1b2836', light: '#ffffff' } }).then((url) => {
      if (alive) setQr(url);
    }).catch(() => {});
    return () => { alive = false; };
  }, [link]);

  return <main className="page narrow share-page">
    <p className="eyebrow">SHARE / 分享牌桌</p>
    <h1>牌桌已创建</h1>
    {error && <Notice invalid>{error}</Notice>}
    {!match && !error && <p className="muted">正在读取牌桌…</p>}
    {match && <section className="panel share-card">
      <h2>{MODE_LABEL[match.mode]} · 等待人齐</h2>
      <p className="muted">把链接、二维码或房间码发给同桌：扫码、点链接或输码进来就是成员，不再经过签到页；人齐后直接随机分座。</p>
      {match.status !== 'waiting' && <Notice>牌局已开始，分享链接不再接受新成员。</Notice>}
      <div className="share-code-block">
        <small>房间码</small>
        <strong>{code || '—'}</strong>
        {code && <CopyButton text={code} label="复制房间码" />}
      </div>
      <label>分享链接
        <input value={link} readOnly onFocus={(event) => event.target.select()} />
      </label>
      <div className="share-actions">
        {link && <CopyButton text={link} label="复制链接" />}
        <Link className="button primary" to={`/table/${match.id}`}>进入牌桌 →</Link>
      </div>
      {qr && <div className="qr-wrap"><img className="qr-img" src={qr} alt="牌桌分享二维码" /><p>扫码直接加入牌桌</p></div>}
    </section>}
  </main>;
}
