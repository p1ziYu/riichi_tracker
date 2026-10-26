export type Mode = '3p' | '4p';
export type MatchStatus = 'waiting' | 'in_progress' | 'finished' | 'cancelled';

export interface MatchMember {
  userId: string;
  displayName: string;
  isHost: boolean;
}

export interface MatchSeat {
  seatNo: number;
  userId: string;
  wind: string | null;
}

export interface FinalScore {
  wind: string;
  score: number;
  rank: number;
}

export interface MatchView {
  id: string;
  mode: Mode;
  status: MatchStatus;
  hostId: string;
  joinCode: string | null;
  inviteCode?: string;
  joinToken?: string;
  joinTokenExpiresAt?: string;
  members: MatchMember[];
  seats: MatchSeat[];
  finalScores: FinalScore[] | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  correctedAt: string | null;
}

export interface Me {
  principal: { id: string; type: string; displayName: string; createdAt: string };
  isAdmin: boolean;
}

export interface AdminPlayer {
  id: string;
  displayName: string;
  matchCount: number;
}

export const MODE_LABEL: Record<Mode, string> = { '4p': '四麻', '3p': '三麻' };

export const STATUS_LABEL: Record<MatchStatus, string> = {
  waiting: '等待人齐',
  in_progress: '进行中',
  finished: '已结束',
  cancelled: '已取消',
};

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
