import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../api';
import { errorTextZh } from '../errors';
import type { MatchView, Mode } from '../types';
import Segmented from '../Segmented';
import { Notice } from './ui';

export default function Create() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('4p');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setBusy(true);
    setError('');
    try {
      const { match } = await post<{ match: MatchView }>('/api/matches', { mode });
      navigate(`/share/${encodeURIComponent(match.id)}`, { state: { match } });
    } catch (cause) {
      setError(errorTextZh(cause));
    } finally {
      setBusy(false);
    }
  }

  return <main className="page narrow">
    <p className="eyebrow">NEW TABLE / 开桌</p>
    <h1>开一桌好牌</h1>
    <section className="panel">
      <Segmented label="对局人数" value={mode}
        options={[{ value: '4p', label: '四麻 · 4 人' }, { value: '3p', label: '三麻 · 3 人' }]}
        onChange={setMode} />
      <div className="rule-detail">
        {mode === '4p'
          ? '四麻：4 人入座，终局合计须为 1000（25000 点记 250）。'
          : '三麻：3 人入座，终局合计须为 1050（35000 点记 350）。'}
        <br />人齐后系统直接随机分座，东座即庄家，座次锁定；打完由房主记终局得点，合计不对不能保存。
      </div>
      <button className="primary" type="button" disabled={busy} onClick={() => void create()}>
        {busy ? '正在开桌…' : '创建牌桌 →'}
      </button>
      {error && <Notice invalid>{error}</Notice>}
    </section>
  </main>;
}
