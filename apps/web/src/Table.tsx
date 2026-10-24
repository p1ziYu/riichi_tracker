import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ResultInput } from '@riichi/engine';
import { ApiError, api, errorText, post, webSocketUrl } from './api';
import { pointText, snapshotRuleSummary, winds } from './rules';
import Segmented from './Segmented';
import { flowError } from './checkInSeats';

type Revision = number | string;
type Seat = {
  seatNo: number;
  principalId?: string | null;
  points?: number;
  displayName?: string;
  memberName?: string;
  memberId?: string;
  status?: string;
  member?: { id?: string; displayName?: string; name?: string } | null;
  initialWind?: string;
};
type Member = { principalId: string; displayName: string; isOwner: boolean; seatNo: number | null; wind: string | null };
type HandSeat = { seatNo: number; points?: number; isRiichi?: boolean; riichiChangeUsage: { declares: number; cancels: number } };
type CurrentHand = {
  id?: string;
  handId?: string;
  roundWind?: 'E' | 'S' | 'W';
  roundNumber?: number;
  dealerSeatNo?: number;
  honba?: number;
  riichiPool?: number;
  markRevision?: Revision;
  status?: string;
  seats?: HandSeat[];
};
type Score = { seatNo: number; points: number };
type CheckIn = { seatNo?: number; memberId?: string; checkedIn?: boolean; isCheckedIn?: boolean; status?: string };
type MatchState = {
  match: { id: string; name?: string; ownerPrincipalId?: string; status: string; joinCode?: string | null; playerCount?: number; seatingDrawnAt: string | null; dealerSeatNo: number | null; handsPlayed?: number; version?: Revision; settlementConfirmed?: boolean; rulesSnapshot?: Record<string, unknown>; rulesetVersionId?: string };
  members: Member[];
  seats: Seat[];
  currentHand: CurrentHand | null;
  scoreboard: Score[] | Record<string, number>;
  checkedIn: CheckIn[] | boolean[] | string[] | Record<string, boolean> | number;
};
type TokenResponse = { token: string; expiresAt?: string };
type PaymentPreview = {
  perSeat: { seatNo: number; netPoints: number; breakdown?: { reason: string; amount: number }[] }[];
  nextHand: { roundWind?: string; roundNumber?: number; dealerSeatNo?: number; honba?: number; riichiPool?: number };
};
type TerminalPreview = { terminalTenths: number[] };
type DraftPreview = { handId: string; revision: string; input: string; output: PaymentPreview };
type Connection = '连接中' | '实时同步中' | '正在重连' | '连接已断开';
const MAX_RECONNECT_FAILURES = 5;

const matchStateLabels: Record<string, string> = {
  preparing: '等待座次确认',
  lobby: '等待座次确认',
  active: '牌局进行中',
  in_progress: '牌局进行中',
  finished: '牌局已结束',
  abandoned: '牌局已取消',
};
const windNames: Record<string, string> = { E: '东', S: '南', W: '西', N: '北' };

function seatLabel(seat: Seat): string {
  return seat.displayName ?? seat.memberName ?? seat.member?.displayName ?? seat.member?.name ?? `座位 ${seat.seatNo + 1}`;
}
function checkInLabel(checkedIn: MatchState['checkedIn'], seat: Seat, ownerPrincipalId?: string): string {
  if (seat.principalId && seat.principalId === ownerPrincipalId && seat.status === 'checked_in') return '房主免签到';
  // Real API contract: per-seat check-in state lives on each seat
  // ('checked_in' | 'assigned' | 'empty'); `checkedIn` is only an aggregate count.
  if (seat.status === 'checked_in') return '已签到';
  if (seat.status === 'assigned') return '未签到';
  if (seat.status === 'empty') return '空座';
  if (Array.isArray(checkedIn)) {
    const value = checkedIn[seat.seatNo];
    if (typeof value === 'boolean') return value ? '已签到' : '未签到';
    const memberId = seat.memberId ?? seat.member?.id;
    if (memberId && (checkedIn as unknown[]).includes(memberId)) return '已签到';
    const record = (checkedIn as CheckIn[]).find((entry) => entry && typeof entry === 'object' &&
      (entry.seatNo === seat.seatNo || (memberId && entry.memberId === memberId)));
    if (record) {
      const done = record.checkedIn ?? record.isCheckedIn;
      if (typeof done === 'boolean') return done ? '已签到' : '未签到';
      if (record.status === 'checked_in') return '已签到';
      if (record.status === 'pending') return '未签到';
    }
  } else if (checkedIn && typeof checkedIn === 'object') {
    const value = checkedIn[String(seat.seatNo)] ?? checkedIn[seat.memberId ?? seat.member?.id ?? ''];
    if (typeof value === 'boolean') return value ? '已签到' : '未签到';
  }
  return '签到状态未提供';
}

function Payments({ output }: { output: PaymentPreview }) {
  return <div className="payment-list">{output.perSeat.map((seat) => <div className="payment-row" key={seat.seatNo}>
    <span>{winds[seat.seatNo]}家</span>
    <strong className={seat.netPoints > 0 ? 'gain' : seat.netPoints < 0 ? 'loss' : ''}>{seat.netPoints > 0 ? '+' : ''}{pointText(seat.netPoints)}</strong>
    {seat.breakdown && <small>{seat.breakdown.map((part) => `${part.reason} ${part.amount > 0 ? '+' : ''}${pointText(part.amount)}`).join(' · ')}</small>}
  </div>)}</div>;
}

function nextHandText(nextHand: PaymentPreview['nextHand']): string {
  const wind = nextHand.roundWind && ({ E: '东', S: '南', W: '西' } as Record<string, string>)[nextHand.roundWind];
  const round = wind && typeof nextHand.roundNumber === 'number'
    ? `${wind}${['一', '二', '三', '四'][nextHand.roundNumber - 1] ?? nextHand.roundNumber}局` : '局次未提供';
  const dealer = typeof nextHand.dealerSeatNo === 'number' ? `庄家 ${winds[nextHand.dealerSeatNo] ?? `座位 ${nextHand.dealerSeatNo + 1}`}` : '庄家未提供';
  const honba = typeof nextHand.honba === 'number' ? `${nextHand.honba} 本场` : '本场未提供';
  const pool = typeof nextHand.riichiPool === 'number' ? `供托 ${nextHand.riichiPool} 根` : '供托未提供';
  return `${round} · ${dealer} · ${honba} · ${pool}`;
}

export function FinalizeDealerBlock({
  dealerSeatNo,
  busy = false,
  onSelectDealer,
}: {
  dealerSeatNo: number | null;
  busy?: boolean;
  onSelectDealer: (seatNo: number | null) => void;
}) {
  return (
    <div className="table-dealer-block">
      <div className="dealer-row">
        <span>起家：</span>
        <button
          type="button"
          aria-pressed={dealerSeatNo === null}
          disabled={busy}
          onClick={() => onSelectDealer(null)}
        >
          随机（默认）
        </button>
      </div>
      <small className="dealer-helper">点击已入座玩家的座位指定东家</small>
    </div>
  );
}

function JoinCodeBlock({ code, copyStatus, onCopy }: { code: string; copyStatus: string; onCopy: () => void }) {
  return <div className="table-join-code">
    <span>房间码</span>
    <strong aria-label={`房间码 ${code}`}>{code}</strong>
    <small>朋友可在首页输入房间码，进入加入牌桌页。</small>
    <button type="button" onClick={onCopy}>复制房间码</button>
    {copyStatus && <small role="status">{copyStatus}</small>}
  </div>;
}

async function copyText(value: string, fallbackHint: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error(fallbackHint);
  } finally {
    field.remove();
  }
}

export default function Table() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [deletedNotice, setDeletedNotice] = useState(false);
  const base = `/api/matches/${encodeURIComponent(id ?? '')}`;
  const requestRef = useRef(0);
  const [loaded, setLoaded] = useState<{ id: string; value: MatchState } | null>(null);
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<Connection>('连接中');
  const [connectionError, setConnectionError] = useState('');
  const [retryConnection, setRetryConnection] = useState(0);
  const [identity, setIdentity] = useState<{ id: string; principalId: string } | null>(null);
  const [templateNames, setTemplateNames] = useState<Record<string, string>>({});
  const [dealerSeatNo, setDealerSeatNo] = useState<number | null>(null);
  const [seatTargets, setSeatTargets] = useState<Record<number, string>>({});
  useEffect(() => {
    let alive = true;
    api<{ versionId: string; name: string }[]>('/api/rulesets/templates').then((templates) => {
      if (alive) setTemplateNames(Object.fromEntries(templates.map((template) => [template.versionId, template.name])));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const [token, setToken] = useState<{ id: string; value: string; expiresAt?: string; memberCountAtIssue: number } | null>(null);
  const [expiredToken, setExpiredToken] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<{ url: string; image: string } | null>(null);
  const [qrError, setQrError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [joinCodeCopyStatus, setJoinCodeCopyStatus] = useState('');
  const [dialog, setDialog] = useState(false);
  const [kind, setKind] = useState<'ron' | 'tsumo' | 'ryuukyoku' | 'nagashi_mangan'>('ron');
  const [winner, setWinner] = useState(0);
  const [dealIn, setDealIn] = useState(1);
  const [han, setHan] = useState(2);
  const [fu, setFu] = useState(30);
  const [tenpai, setTenpai] = useState<Record<number, boolean>>({});
  const [nagashiRiver, setNagashiRiver] = useState('');
  const [nagashiAttested, setNagashiAttested] = useState(false);
  const [draftPreview, setDraftPreview] = useState<DraftPreview | null>(null);
  const [terminalPreview, setTerminalPreview] = useState<{ id: string; stateKey: string; output: TerminalPreview } | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    const request = ++requestRef.current;
    try {
      const value = await api<MatchState>(base);
      if (request === requestRef.current) {
        setLoaded({ id, value });
        setLoadError(null);
      }
    } catch (error) {
      if (request === requestRef.current) setLoadError({ id, message: errorText(error) });
      throw error;
    }
  }, [id, base]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setIdentity(null);
    setDealerSeatNo(null);
    setSeatTargets({});
    setToken(null);
    setJoinCodeCopyStatus('');
    setDialog(false);
    setDraftPreview(null);
    setTerminalPreview(null);
    setActionError('');
    void refresh().catch(() => {}); // The GET error is rendered from loadError.
    void api<{ principal: { id: string } }>('/api/me')
      .then(({ principal }) => { if (alive) setIdentity({ id, principalId: principal.id }); })
      .catch((error: unknown) => { if (alive) setActionError(`读取身份失败：${errorText(error)}`); });
    return () => { alive = false; ++requestRef.current; };
  }, [id, refresh]);

  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let failures = 0;
    let timer: number | undefined;
    let stableTimer: number | undefined;
    let socket: WebSocket | undefined;
    let connecting = false;
    setConnection('连接中');
    setConnectionError('');

    const available = () => navigator.onLine && document.visibilityState === 'visible';
    const schedule = () => {
      if (stopped || failures >= MAX_RECONNECT_FAILURES) return;
      window.clearTimeout(timer);
      timer = undefined;
      if (!available()) {
        setConnection('连接已断开');
        return;
      }
      setConnection('正在重连');
      const ceiling = Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
      timer = window.setTimeout(() => { timer = undefined; void connect(); }, ceiling * (0.75 + Math.random() * 0.25));
    };
    const failed = (message: string) => {
      if (stopped) return;
      setConnectionError(message);
      failures += 1;
      if (failures >= MAX_RECONNECT_FAILURES) setConnection('连接已断开');
      else schedule();
    };
    const connect = async () => {
      if (stopped || connecting || socket || failures >= MAX_RECONNECT_FAILURES || !available()) return;
      connecting = true;
      try {
        // Tickets are single-use: request one for every individual connection attempt.
        const { ticket } = await post<{ ticket: string }>(`${base}/ws-tickets`);
        if (stopped) return;
        if (!ticket) throw new Error('服务端未返回实时连接凭据');
        if (!available()) { schedule(); return; }
        const ws = new WebSocket(`${webSocketUrl(`/ws/matches/${encodeURIComponent(id)}`)}?ticket=${encodeURIComponent(ticket)}`);
        socket = ws;
        ws.onopen = () => {
          if (stopped) return;
          stableTimer = window.setTimeout(() => { failures = 0; }, 10_000);
          setConnection('实时同步中');
          setConnectionError('');
          void refresh().catch(() => {});
        };
        ws.onmessage = (event) => {
          if (stopped) return;
          try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : null;
            if (data?.type === 'room_deleted') {
              setDeletedNotice(true);
              setActionError('牌桌已被房主删除');
              window.setTimeout(() => {
                if (!stopped) navigate('/history', { replace: true });
              }, 1500);
              return;
            }
          } catch {}
          void refresh().catch(() => {});
        };
        ws.onerror = () => { setConnectionError('实时连接失败'); ws.close(); };
        ws.onclose = () => {
          if (socket !== ws) return;
          window.clearTimeout(stableTimer);
          socket = undefined;
          failed('实时连接已断开');
        };
      } catch (error) {
        failed(errorText(error));
      } finally {
        connecting = false;
        if (!stopped && !socket && timer === undefined && failures < MAX_RECONNECT_FAILURES && available()) schedule();
      }
    };
    const resume = () => {
      if (stopped) return;
      if (!available()) {
        window.clearTimeout(timer);
        window.clearTimeout(stableTimer);
        timer = undefined;
        stableTimer = undefined;
        if (socket) {
          const old = socket;
          socket = undefined;
          old.onclose = null;
          old.close();
        }
        setConnection('连接已断开');
      } else if (!socket && !connecting && failures < MAX_RECONNECT_FAILURES) schedule();
    };
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    document.addEventListener('visibilitychange', resume);
    if (available()) void connect();
    else setConnection('连接已断开');
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(stableTimer);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
      document.removeEventListener('visibilitychange', resume);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [id, base, refresh, retryConnection]);

  const state = loaded && loaded.id === id ? loaded.value : null;
  const checkInUrl = token && token.id === id && expiredToken !== token.value &&
    state?.match.status === 'preparing' && (state.members.length < (state.match.playerCount ?? 0)) &&
    state.members.length <= token.memberCountAtIssue &&
    (!token.expiresAt || Date.parse(token.expiresAt) > Date.now())
    ? new URL(`/checkin/${encodeURIComponent(id!)}?token=${encodeURIComponent(token.value)}`, 'https://riichi.p1ziyu.com').href : null;
  useEffect(() => {
    if (token && token.id === id && state && state.members.length > token.memberCountAtIssue) {
      setExpiredToken(token.value);
    }
  }, [id, token, state?.members.length]);
  useEffect(() => {
    if (!token?.expiresAt || token.id !== id) return;
    const remaining = Date.parse(token.expiresAt) - Date.now();
    if (remaining <= 0) {
      setExpiredToken(token.value);
      return;
    }
    const timer = window.setTimeout(() => setExpiredToken(token.value), remaining);
    return () => window.clearTimeout(timer);
  }, [token, id]);
  useEffect(() => {
    if (!checkInUrl) return;
    let alive = true;
    setQrCode(null);
    setQrError('');
    setCopyStatus('');
    void QRCode.toDataURL(checkInUrl, { errorCorrectionLevel: 'M', margin: 2, width: 256 })
      .then((image) => { if (alive) setQrCode({ url: checkInUrl, image }); })
      .catch((error: unknown) => { if (alive) setQrError(errorText(error)); });
    return () => { alive = false; };
  }, [checkInUrl]);

  const isOwner = !!state?.match.ownerPrincipalId && identity !== null && identity.id === id && identity.principalId === state.match.ownerPrincipalId;
  const preparing = state?.match.status === 'preparing' || state?.match.status === 'lobby';
  const drawn = state?.match.seatingDrawnAt != null;
  const members = state?.members ?? [];
  const hand = state?.currentHand ?? null;
  const seats = useMemo(() => [...(state?.seats ?? [])].sort((a, b) => a.seatNo - b.seatNo), [state?.seats]);
  const legacySeated = !drawn && seats.length === state?.match.playerCount &&
    seats.every((seat) => seat.principalId && seat.status === 'checked_in');
  const handSeats = hand?.seats ?? [];
  const matchInProgress = state?.match.status === 'active' || state?.match.status === 'in_progress';
  const activeHand = matchInProgress && hand && (!hand.status || ['active', 'open', 'in_progress'].includes(hand.status));
  const betweenHands = !hand || ['settled', 'completed', 'finished'].includes(hand.status ?? '');
  const nagashiEnabled = state?.match.rulesSnapshot?.nagashiManganEnabled === true;
  const nagashiTiles = nagashiRiver.trim().split(/[\s,，]+/).filter(Boolean);
  const input: ResultInput = kind === 'ryuukyoku'
    ? { kind, winners: [], tenpai: seats.map((seat) => !!tenpai[seat.seatNo]) }
    : kind === 'nagashi_mangan'
      ? { kind, winners: [{ seatNo: winner, han: 5, fu: 30 }],
        tenpai: seats.map((seat) => !!tenpai[seat.seatNo]),
        nagashiEligibility: [{ seatNo: winner, discards: nagashiTiles.map((tile) => ({ tile, called: false })) }] }
      : { kind, winners: [{ seatNo: winner, han, fu, ...(kind === 'ron' ? { dealInSeatNo: dealIn } : {}) }] };
  const inputKey = JSON.stringify(input);
  const revision = hand?.markRevision == null ? '' : String(hand.markRevision);
  const handId = hand?.id ?? hand?.handId;
  const shownPreview = draftPreview && draftPreview.handId === handId && draftPreview.revision === revision && draftPreview.input === inputKey
    ? draftPreview.output : null;
  const stateKey = JSON.stringify([state?.match.status, state?.match.version, state?.scoreboard, handId, revision]);
  const shownTerminalPreview = terminalPreview && terminalPreview.id === id && terminalPreview.stateKey === stateKey ? terminalPreview.output : null;
  const invalid = seats.length === 0 || (kind !== 'ryuukyoku' &&
    (!seats.some((seat) => seat.seatNo === winner) ||
      (kind === 'nagashi_mangan'
        ? !nagashiEnabled || !nagashiAttested || nagashiTiles.length === 0 || nagashiTiles.some((tile) => !/^(?:[19][mps]|[1-7]z)$/.test(tile))
        : !Number.isInteger(han) || han < 1 || !Number.isInteger(fu) || fu < 20 ||
          (kind === 'ron' && (winner === dealIn || !seats.some((seat) => seat.seatNo === dealIn))))));

  const action = async (operation: () => Promise<void>, seating = false) => {
    setBusy(true);
    setActionError('');
    try {
      await operation();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try { await refresh(); } catch { /* The GET error is separately displayed. */ }
        setDraftPreview(null);
        setTerminalPreview(null);
        setActionError(seating ? flowError(error) : error.code === 'riichi_change_budget_exceeded' ? errorText(error) : '数据已更新，请重试');
      } else {
        setActionError(seating ? flowError(error) : errorText(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const changeMark = (seat: HandSeat, riichi: boolean) => {
    if (!handId || typeof seat.isRiichi !== 'boolean' || seat.isRiichi === riichi) return;
    void action(async () => {
      await post(`${base}/hands/${encodeURIComponent(handId)}/marks`, {
        seatNo: seat.seatNo,
        riichi,
        ...(hand?.markRevision != null ? { expectedMarkRevision: hand.markRevision } : {}),
      });
      setDraftPreview(null);
      await refresh();
    });
  };

  const previewHand = () => {
    if (!handId || invalid || revision === '') return;
    void action(async () => {
      setDraftPreview(null);
      const output = await post<PaymentPreview>(`${base}/hands/${encodeURIComponent(handId)}/preview`, { resultInput: input });
      if (!Array.isArray(output?.perSeat) || output.perSeat.length !== seats.length ||
        output.perSeat.some((seat) => !Number.isInteger(seat.seatNo) || !Number.isFinite(seat.netPoints) ||
          (seat.breakdown != null && (!Array.isArray(seat.breakdown) || seat.breakdown.some((part) => typeof part.reason !== 'string' || !Number.isFinite(part.amount)))) ||
          !seats.some((assigned) => assigned.seatNo === seat.seatNo)) ||
        new Set(output.perSeat.map((seat) => seat.seatNo)).size !== seats.length ||
        !output.nextHand || typeof output.nextHand !== 'object') {
        throw new Error('服务端未返回完整的逐座支付与下一局预览');
      }
      setDraftPreview({ handId, revision, input: inputKey, output });
    });
  };

  const submitHand = () => {
    if (!handId || !shownPreview || invalid || revision === '') return;
    void action(async () => {
      await post(`${base}/hands/${encodeURIComponent(handId)}/results`, { resultInput: input, confirmedMarkRevision: hand!.markRevision });
      await refresh();
      setDraftPreview(null);
      setDialog(false);
      setTenpai({});
    });
  };

  const fetchTerminalPreview = () => {
    if (!id) return;
    void action(async () => {
      setTerminalPreview(null);
      const output = await api<TerminalPreview>(`${base}/settlement/preview`);
      if (!Array.isArray(output?.terminalTenths) || output.terminalTenths.length !== seats.length ||
        output.terminalTenths.some((value) => !Number.isInteger(value))) {
        throw new Error('服务端未返回完整的终局逐座成绩');
      }
      setTerminalPreview({ id, stateKey, output });
    });
  };

  const pointsFor = (seat: Seat): number | undefined => {
    const score = state?.scoreboard;
    const fromScore = Array.isArray(score) ? score.find((entry) => entry.seatNo === seat.seatNo)?.points : score?.[String(seat.seatNo)];
    return fromScore ?? handSeats.find((entry) => entry.seatNo === seat.seatNo)?.points ?? seat.points;
  };
  const copyCheckIn = async () => {
    if (!checkInUrl) return;
    try {
      await copyText(checkInUrl, '请长按签到链接复制');
      setCopyStatus('链接已复制');
    } catch (error) {
      setCopyStatus(`复制失败：${errorText(error)}`);
    }
  };
  const copyJoinCode = async () => {
    if (!state?.match.joinCode) return;
    try {
      await copyText(state.match.joinCode, '请长按房间码复制');
      setJoinCodeCopyStatus('房间码已复制');
    } catch (error) {
      setJoinCodeCopyStatus(`复制失败：${errorText(error)}`);
    }
  };

  const statusText = state ? (state.match.status ? matchStateLabels[state.match.status] ?? state.match.status : '牌桌状态未提供') : '读取牌桌状态中';

  return <main className="page table-page">
    <div className="table-heading"><div><p className="eyebrow">LIVE TABLE / 实时牌桌</p><h1>{state?.match.name ?? '牌桌'}</h1><p className="muted">{statusText} · <span role="status">{connection}</span></p>
      {state?.match.rulesSnapshot && (() => { const summary = snapshotRuleSummary(state.match.rulesSnapshot, templateNames[state.match.rulesetVersionId ?? ''] ?? state.match.name ?? '规则模板');
        return <p className="rule-detail">{summary.title}{summary.changes.length ? ` · ${summary.changes.join('、')}` : ''}</p>; })()}
    </div><button type="button" onClick={() => void refresh().catch(() => {})} disabled={busy}>刷新牌桌</button></div>
    {(connectionError || connection === '连接已断开') && <div className="notice invalid table-connection" role="status">
      实时连接：{connectionError || '当前离线或页面处于后台'}。{connection === '连接已断开' ? '实时同步已暂停，可手动刷新牌桌。' : '正在尝试重新连接。'}
      {connection === '连接已断开' && <button type="button" onClick={() => setRetryConnection((count) => count + 1)}>重连</button>}
    </div>}
    {deletedNotice && <div className="notice invalid" role="alert">牌桌已被房主删除</div>}
    {loadError && loadError.id === id && <div className="notice invalid" role="alert">读取牌桌失败：{loadError.message}<button type="button" onClick={() => void refresh().catch(() => {})}>重试读取</button></div>}
    {actionError && <div className="notice invalid" role="alert">{actionError}</div>}
    {!state && loadError?.id !== id && <p className="notice" role="status">正在读取牌桌…</p>}
    {!state && loadError?.id === id && <Link className="button" to="/create">返回开桌</Link>}
    {state && <>
      <section className={`panel table-checkin${preparing ? ' table-checkin-preparing' : ''}${isOwner && preparing ? ' table-checkin-owner' : ''}`}><div className="section-heading"><span>{preparing ? '成员与座位' : '座次与签到'}</span><small>以服务端状态为准</small></div>
        {preparing ? <>
          <p className="muted">成员 {members.length} / {state.match.playerCount}</p>
          {!isOwner && members.some((member) => member.principalId === identity?.principalId) && !drawn &&
            <p className="muted">已加入，等待房主抽风定座</p>}
          <div className="member-list">{members.map((member) => <div key={member.principalId}>
            <span className="wind-badge">{drawn && member.wind ? windNames[member.wind] ?? member.wind : member.seatNo !== null && legacySeated ? member.seatNo + 1 : '·'}</span>
            <span>{member.displayName} {member.isOwner && <small className="tag">房主</small>}</span>
            <small>{drawn && member.seatNo !== null ? `${windNames[member.wind ?? ''] ?? member.wind ?? ''} · 座位 ${member.seatNo + 1}${member.wind === 'E' ? ' · 庄家（起家）' : ''}` : legacySeated && member.seatNo !== null ? `座位 ${member.seatNo + 1} · 已入座` : '尚未定座'}</small>
            {isOwner && member.seatNo !== null && <div className="seat-reassign">
              <select aria-label={`将${member.displayName}移至座位`} value={seatTargets[member.seatNo] ?? ''} disabled={busy}
                onChange={(event) => setSeatTargets((current) => ({ ...current, [member.seatNo!]: event.target.value }))}>
                <option value="">选择目标座位</option>
                {seats.filter((target) => target.seatNo !== member.seatNo).map((target) => {
                  const occupant = members.find((entry) => entry.seatNo === target.seatNo);
                  return <option value={target.seatNo} key={target.seatNo}>座位 {target.seatNo + 1} · {occupant ? `与${occupant.displayName}交换` : '空座'}</option>;
                })}
              </select>
              <button type="button" disabled={busy || !seatTargets[member.seatNo]}
                onClick={() => void action(async () => {
                  await post(`${base}/seats/reassign`, { fromSeatNo: member.seatNo, toSeatNo: Number(seatTargets[member.seatNo!]) });
                  setSeatTargets({});
                  setDealerSeatNo(null);
                  await refresh();
                }, true)}>移动 / 交换</button>
            </div>}
            {isOwner && !member.isOwner && <button type="button" className="text-button danger" disabled={busy}
              onClick={() => {
                if (!window.confirm(`确定将${member.displayName}移出牌桌？${drawn ? '移出后将重置抽风结果。' : '移出后可邀请其他玩家加入。'}`)) return;
                void action(async () => {
                  await post(`${base}/members/${encodeURIComponent(member.principalId)}/remove`, {});
                  setSeatTargets({});
                  setDealerSeatNo(null);
                  await refresh();
                }, true);
              }}>移出玩家</button>}
            {isOwner && legacySeated && member.seatNo !== null &&
              <button type="button" className="text-button" aria-pressed={dealerSeatNo === member.seatNo} disabled={busy} onClick={() => setDealerSeatNo(member.seatNo)}>{dealerSeatNo === member.seatNo ? '起家 · 东家' : '设为起家'}</button>}
          </div>)}</div>
          {isOwner && <>
            {!drawn && !legacySeated && <div className="table-controls">
              <button type="button" className="primary" disabled={busy || members.length !== state.match.playerCount}
                onClick={() => void action(async () => {
                  await post(`${base}/seats/draw`, {});
                  setSeatTargets({});
                  await refresh();
                }, true)}>抽风定座</button>
              {members.length < (state.match.playerCount ?? 0) && <small>还差 {(state.match.playerCount ?? 0) - members.length} 人</small>}
            </div>}
            {drawn ? <p className="muted">起家：{members.find((member) => member.wind === 'E')?.displayName ?? '东家'}（抽风决定）</p> :
              legacySeated && <FinalizeDealerBlock dealerSeatNo={dealerSeatNo} busy={busy} onSelectDealer={setDealerSeatNo} />}
            {state.match.joinCode && !checkInUrl && <JoinCodeBlock code={state.match.joinCode} copyStatus={joinCodeCopyStatus} onCopy={() => void copyJoinCode()} />}
            <div className="table-controls table-controls-finalize">
              <button type="button" disabled={busy || members.length >= (state.match.playerCount ?? 0)} onClick={() => void action(async () => {
                setToken(null);
                const result = await post<TokenResponse>(`${base}/check-in-tokens`, {});
                if (!result?.token) throw new Error('服务端未返回签到令牌');
                setToken({ id: id!, value: result.token, expiresAt: result.expiresAt, memberCountAtIssue: members.length });
              }, true)}>生成玩家加入链接</button>
              <button type="button" className="primary" disabled={busy || (!drawn && !legacySeated)}
                onClick={() => void action(async () => {
                  await post(`${base}/seats/finalize`, drawn || dealerSeatNo === null ? {} : { dealerSeatNo });
                  await refresh();
                }, true)}>{drawn ? '开局' : '确认座次并开局'}</button>
              {!drawn && !legacySeated && <small>请先等人齐并抽风定座</small>}
            </div>
          </>}
          {isOwner && token?.id === id && !checkInUrl && members.length < (state.match.playerCount ?? 0) &&
            <p className="notice" role="status">签到链接已使用或过期，请重新生成。</p>}
          {isOwner && checkInUrl && <div className="table-invite"><div className="table-qr">{qrCode?.url === checkInUrl ? <img src={qrCode.image} width="256" height="256" alt="扫描二维码打开玩家加入链接" /> : <span role="status">{qrError ? '二维码生成失败，请使用下方链接' : '正在生成加入二维码…'}</span>}</div><div className="table-invite-details">{state.match.joinCode && <JoinCodeBlock code={state.match.joinCode} copyStatus={joinCodeCopyStatus} onCopy={() => void copyJoinCode()} />}<p>玩家加入链接</p><small>每位玩家打开链接即可加入牌桌；人齐后由房主抽风定座。每个链接仅供一位玩家使用，加入后请为下一位重新生成。</small><a href={checkInUrl}>{checkInUrl}</a>{token?.expiresAt && <small>截止 {token.expiresAt}</small>}<button type="button" onClick={() => void copyCheckIn()}>复制加入链接</button>{copyStatus && <small role="status">{copyStatus}</small>}</div></div>}
        </> : <div className="member-list">{seats.map((seat) => <div key={seat.seatNo}><span className="wind-badge">{seat.seatNo + 1}</span><span>{seatLabel(seat)} · 座位 {seat.seatNo + 1}</span><small>{checkInLabel(state.checkedIn, seat, state.match.ownerPrincipalId)}</small></div>)}</div>}
      </section>
      <div className="table-layout"><section className="felt" aria-label="牌桌座位"><div className="felt-lines" aria-hidden="true" /><div className="seat-grid">{seats.map((seat) => {
        const inHand = handSeats.find((entry) => entry.seatNo === seat.seatNo);
        const points = pointsFor(seat);
        return <article className={`seat seat-${seat.seatNo}`} key={seat.seatNo}><div className="seat-top"><span className="wind-badge">{hand ? winds[(seat.seatNo - hand.dealerSeatNo! + seats.length) % seats.length] : dealerSeatNo === null ? seat.seatNo + 1 : winds[(seat.seatNo - dealerSeatNo + seats.length) % seats.length]}</span><span className="seat-name">{seatLabel(seat)}{hand?.dealerSeatNo === seat.seatNo && <em>庄家</em>}</span></div><strong>{typeof points === 'number' ? pointText(points) : '点数未提供'}</strong>{!hand && <small className="seat-status">{checkInLabel(state.checkedIn, seat, state.match.ownerPrincipalId)}</small>}{activeHand && inHand && <><div className="riichi-actions"><button type="button" className={inHand.isRiichi ? 'riichi marked' : 'riichi'} disabled={busy || !handId || inHand.isRiichi !== false || inHand.riichiChangeUsage.declares >= 2 || (typeof inHand.points === 'number' && inHand.points < 1000 && state.match.rulesSnapshot?.allowLowPointRiichi !== true)} onClick={() => changeMark(inHand, true)}>宣言</button><button type="button" className="riichi" disabled={busy || !handId || inHand.isRiichi !== true || inHand.riichiChangeUsage.cancels >= 1} onClick={() => changeMark(inHand, false)}>取消</button></div><small className="seat-status">还可立直 {Math.max(0, 2 - inHand.riichiChangeUsage.declares)} 次 · 还可取消 {Math.max(0, 1 - inHand.riichiChangeUsage.cancels)} 次</small></>}</article>;
      })}<div className="table-center">{hand ? <><span>{hand.roundWind && typeof hand.roundNumber === 'number' ? `${({ E: '东', S: '南', W: '西' } as const)[hand.roundWind]}${['一', '二', '三', '四'][hand.roundNumber - 1] ?? hand.roundNumber}局` : '当前局'}</span><b>{typeof hand.honba === 'number' ? `${hand.honba} 本场` : '本场未提供'}</b><small>{typeof hand.riichiPool === 'number' ? `供托 ${hand.riichiPool} 根` : '供托未提供'}</small></> : <span>{['preparing', 'lobby'].includes(state.match.status) ? '等待座次确认' : '待开下一局'}</span>}</div></div></section>
      <aside className="panel table-aside"><h2>牌局操作</h2><div className="aside-stat"><span>牌桌状态</span><b>{statusText}</b></div>{hand && <div className="aside-stat"><span>立直标记版本</span><b>{revision || '未提供'}</b></div>}
        <p className="note">立直标记同步至同桌，确认本局结果时才由服务端结算点数。{activeHand && !handId && '当前局标识未提供，无法操作本局。'}</p>
        {matchInProgress && betweenHands && <button type="button" className="primary" disabled={busy} onClick={() => void action(async () => { await post(`${base}/hands`, {}); await refresh(); })}>新开一局</button>}
        {matchInProgress && activeHand && <button type="button" className="primary" disabled={busy || !handId} onClick={() => { setActionError(''); setDraftPreview(null); setDialog(true); }}>录入本局结果 →</button>}
        {isOwner && matchInProgress && betweenHands && state.match.rulesSnapshot?.automaticEndPolicy !== 'ranked_sanma' && <button type="button" disabled={busy} onClick={() => void action(async () => { await post(`${base}/finish`, {}); await refresh(); setTerminalPreview(null); })}>终局</button>}
        {state.match.status === 'finished' && <><button type="button" disabled={busy} onClick={fetchTerminalPreview}>预览终局成绩</button>{shownTerminalPreview && <><div className="payment-list">{seats.map((seat, index) => <div className="payment-row" key={seat.seatNo}><span>{winds[seat.seatNo]}家</span><strong>{(shownTerminalPreview.terminalTenths[index] / 10).toFixed(1)}</strong><small>{seatLabel(seat)} · 终局成绩</small></div>)}</div>{isOwner && <button type="button" className="primary" disabled={busy || state.match.settlementConfirmed === true} onClick={() => void action(async () => { await post(`${base}/settlement/confirm`, {}); await refresh(); setTerminalPreview(null); })}>{state.match.settlementConfirmed ? '终局已确认' : '确认终局成绩'}</button>}</>}</>}
      </aside></div>
    </>}
    {dialog && hand && activeHand && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(false); }}><section className="dialog panel" role="dialog" aria-modal="true" aria-label="录入结算"><div className="dialog-head"><div><p className="eyebrow">SETTLEMENT / 本局结算</p><h2>支付确认</h2></div><button type="button" className="close" aria-label="关闭" disabled={busy} onClick={() => setDialog(false)}>×</button></div><p className="muted">支付明细来自服务端；立直标记或输入变化后需重新预览。</p><Segmented label="结果类型" value={kind} options={([
      { value: 'ron', label: '荣和' }, { value: 'tsumo', label: '自摸' },
      { value: 'ryuukyoku', label: '荒牌流局' }, ...(nagashiEnabled ? [{ value: 'nagashi_mangan' as const, label: '流局满贯' }] : []),
    ] as const)} onChange={(value) => { setKind(value); setActionError(''); }} />
      {kind === 'ryuukyoku' ? <div className="tenpai-grid">{seats.map((seat) => <label className="toggle" key={seat.seatNo}><span>{winds[seat.seatNo]}家听牌</span><input type="checkbox" checked={!!tenpai[seat.seatNo]} onChange={(event) => setTenpai((current) => ({ ...current, [seat.seatNo]: event.target.checked }))} /></label>)}</div> : <div className="field-grid"><label>{kind === 'nagashi_mangan' ? '流局满贯座位' : '和牌座位'}<select value={winner} onChange={(event) => setWinner(Number(event.target.value))}>{seats.map((seat) => <option key={seat.seatNo} value={seat.seatNo}>{winds[seat.seatNo]}家 · {seatLabel(seat)}</option>)}</select></label>{kind === 'ron' && <label>放铳座位<select value={dealIn} onChange={(event) => setDealIn(Number(event.target.value))}>{seats.map((seat) => <option key={seat.seatNo} value={seat.seatNo}>{winds[seat.seatNo]}家 · {seatLabel(seat)}</option>)}</select></label>}{kind === 'nagashi_mangan' ? <><label>完整弃牌（逗号或空格分隔，例如 1m 9p 1z）<input value={nagashiRiver} onChange={(event) => setNagashiRiver(event.target.value)} /></label><label className="toggle"><input type="checkbox" checked={nagashiAttested} onChange={(event) => setNagashiAttested(event.target.checked)} />确认以上为全部弃牌，均为幺九且未被他家鸣走</label></> : <><label>番<input type="number" inputMode="numeric" step={1} value={Number.isNaN(han) ? '' : han} onChange={(event) => setHan(event.target.value === '' ? NaN : Number(event.target.value))} /></label><label>符<input type="number" inputMode="numeric" step={1} value={Number.isNaN(fu) ? '' : fu} onChange={(event) => setFu(event.target.value === '' ? NaN : Number(event.target.value))} /></label></>}</div>}
      {kind === 'nagashi_mangan' && <div className="tenpai-grid">{seats.map((seat) => <label className="toggle" key={seat.seatNo}><span>{winds[seat.seatNo]}家听牌（庄家听牌连庄）</span><input type="checkbox" checked={!!tenpai[seat.seatNo]} onChange={(event) => setTenpai((current) => ({ ...current, [seat.seatNo]: event.target.checked }))} /></label>)}</div>}
      {invalid && <div className="notice invalid" role="alert">{kind === 'nagashi_mangan' ? '请填写完整的未被鸣走的幺九弃牌，并确认记录完整。' : '请输入有效座位与番符；荣和的胜者与放铳者不可相同。'}</div>}
      {(!handId || revision === '') && <div className="notice invalid" role="alert">服务端未提供当前局标识或立直标记版本，无法提交结算。</div>}
      {shownPreview && <><h3>逐座支付</h3><Payments output={shownPreview} /><p className="rule-detail">下一局：{nextHandText(shownPreview.nextHand)}</p></>}
      {actionError && <div className="notice invalid" role="alert">{actionError}</div>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setDialog(false)}>取消</button><button type="button" disabled={busy || invalid || !handId || revision === ''} onClick={previewHand}>服务端预览支付</button><button type="button" className="primary" disabled={busy || invalid || !shownPreview} onClick={submitHand}>确认并结算</button></div></section></div>}
  </main>;
}
