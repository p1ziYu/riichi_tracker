import { useEffect, useMemo, useState } from 'react';
import { api, post } from '../api';
import { errorTextZh } from '../errors';
import { appendKey, parseScore, rankLabel, rankScores, totalFor, validateScores, WIND_LABEL, windsFor } from '../finalScores';
import type { MatchView } from '../types';
import { memberName } from './ui';
import { Notice } from './ui';

export type EditorMode = 'record' | 'correct' | 'admin-correct';

const KEYPAD: string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '0', 'back'];

export default function FinalScoresEditor({ match, mode, onSaved }: {
  match: MatchView;
  mode: EditorMode;
  onSaved: (view: MatchView) => void;
}) {
  const winds = useMemo(() => windsFor(match.mode), [match.mode]);
  const total = totalFor(match.mode);
  const [texts, setTexts] = useState<string[]>(() => {
    if (mode === 'record') return winds.map(() => '');
    const byWind = new Map((match.finalScores ?? []).map((entry) => [entry.wind, String(entry.score)]));
    return winds.map((wind) => byWind.get(wind) ?? '');
  });
  const [selected, setSelected] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Physical keyboard mirrors the on-screen keypad for the selected row.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === 'Backspace' || event.key === '-' || /^[0-9]$/.test(event.key)) {
        event.preventDefault();
        setTexts((current) => current.map((text, index) =>
          index === selected ? appendKey(text, event.key === 'Backspace' ? 'back' : event.key) : text));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const values = texts.map(parseScore);
  const allFilled = values.every((value) => value !== null);
  const validation = validateScores(match.mode, texts);
  const sum = values.reduce<number>((acc, value) => acc + (value ?? 0), 0);
  const ranks = allFilled
    ? rankScores(winds.map((wind, index) => ({ wind, score: values[index] ?? 0 })))
    : null;

  async function save() {
    if (!validation.ok || busy) return;
    setBusy(true);
    setError('');
    const scores = winds.map((wind, index) => ({ wind, score: values[index] ?? 0 }));
    try {
      const path = mode === 'admin-correct'
        ? `/api/admin/matches/${encodeURIComponent(match.id)}/final-scores`
        : `/api/matches/${encodeURIComponent(match.id)}/final-scores`;
      const view = mode === 'record'
        ? await post<MatchView>(path, { scores })
        : await api<MatchView>(path, { method: 'PATCH', body: JSON.stringify({ scores }) });
      onSaved(view);
    } catch (cause) {
      setError(errorTextZh(cause));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel score-editor" aria-label="终局得点">
    <div className="section-heading"><span>{mode === 'record' ? '终局得点' : '纠正终局得点'}</span>
      <small>单位：实际 100 点 · 支持负数和 0</small></div>
    <p className="muted">先选左侧得点栏，再用数字键盘输入。座次已锁定，只能改得点。</p>
    <div className="score-rows">
      {winds.map((wind, index) => {
        const seat = match.seats.find((item) => item.wind === wind);
        const name = seat ? memberName(match, seat.userId) : '—';
        const rank = ranks?.find((entry) => entry.wind === wind)?.rank;
        return <button key={wind} type="button"
          className={`score-row${selected === index ? ' selected' : ''}`}
          onClick={() => setSelected(index)}
          aria-label={`${WIND_LABEL[wind]}位 ${name} 得点`}>
          <span className="wind-badge">{WIND_LABEL[wind]}</span>
          <span className="ellipsis">{name}{seat?.seatNo === 0 ? <small className="tag">庄家</small> : null}</span>
          <span className="score-field" aria-live="off">{texts[index] === '' ? '—' : texts[index]}</span>
          <span>{rank ? rankLabel(rank) : '—'}</span>
        </button>;
      })}
    </div>
    <div className="total-bar" role="status">
      <span>当前合计</span>
      <strong className={validation.ok ? 'gain' : ''}>{sum} / {total}</strong>
      <small>{validation.ok ? '✓ 合计正确，可以保存。' : validation.reason}</small>
    </div>
    <div className="keypad" aria-label="数字键盘">
      {KEYPAD.map((key) => <button key={key} type="button" onClick={() => {
        setTexts((current) => current.map((text, index) => index === selected ? appendKey(text, key) : text));
      }}>{key === 'back' ? '⌫' : key}</button>)}
    </div>
    <div className="dialog-actions">
      <button type="button" className="text-button" onClick={() => setTexts(winds.map(() => ''))}>全部清空</button>
      <button type="button" className="primary" disabled={!validation.ok || busy} onClick={() => void save()}>
        {busy ? '正在保存…' : mode === 'record' ? '确认保存' : '保存修改'}
      </button>
    </div>
    {error && <Notice invalid>{error}</Notice>}
    <p className="note">同点顺位：{match.mode === '3p' ? '东 > 南 > 西' : '东 > 南 > 西 > 北'}。</p>
  </section>;
}
