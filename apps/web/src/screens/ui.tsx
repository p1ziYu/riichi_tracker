import { useState } from 'react';
import type { MatchView } from '../types';
import { WIND_LABEL } from '../finalScores';

export function Notice({ invalid, children }: { invalid?: boolean; children: React.ReactNode }) {
  return <div className={`notice${invalid ? ' invalid' : ''}`} role={invalid ? 'alert' : 'status'}>{children}</div>;
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  return <button type="button" className="text-button" onClick={() => void copy()}>{copied ? '已复制 ✓' : label}</button>;
}

export function memberName(view: MatchView, userId: string): string {
  return view.members.find((member) => member.userId === userId)?.displayName ?? '未知玩家';
}

export function seatName(view: MatchView, wind: string): string {
  const seat = view.seats.find((item) => item.wind === wind);
  return seat ? memberName(view, seat.userId) : '—';
}

export function WindTile({ wind }: { wind: string }) {
  return <span className="wind-badge">{WIND_LABEL[wind] ?? wind}</span>;
}

// Finished-match score table, rank order. Pure display, no editing.
export function FinalScoreTable({ view }: { view: MatchView }) {
  if (!view.finalScores) return null;
  const ordered = [...view.finalScores].sort((a, b) => a.rank - b.rank);
  return <div className="score-table" role="table" aria-label="终局得点">
    {ordered.map((entry) => <div className="score-table-row" role="row" key={entry.wind}>
      <span>{['一位', '二位', '三位', '四位'][entry.rank - 1] ?? `${entry.rank}位`}</span>
      <WindTile wind={entry.wind} />
      <span className="ellipsis">{seatName(view, entry.wind)}</span>
      <strong className={entry.score > 0 ? 'gain' : entry.score < 0 ? 'loss' : ''}>
        {entry.score > 0 ? `+${entry.score}` : `${entry.score}`}
      </strong>
    </div>)}
  </div>;
}
