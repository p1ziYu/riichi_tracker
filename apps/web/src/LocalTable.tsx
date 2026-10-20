import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ResultInput, SettlementOutput, TerminalSettlementOutput } from '@riichi/engine';
import { confirmLocalTerminal, finishLocalMatch, getLocalMatch, LOCAL_MATCHES_STORAGE_KEY, LOCAL_SEEDS, markLocalRiichi, openLocalHand, previewLocalHand, previewLocalTerminal, seedRules, settleLocalHand, updateLocalMatch } from './localMatches';
import type { LocalMatch } from './localMatches';
import { errorText } from './api';
import { pointText, ruleSummary, winds } from './rules';
import Segmented from './Segmented';

const windName: Record<string, string> = { E: '东', S: '南', W: '西' };
function roundText(wind: string, round: number): string {
  return `${windName[wind] ?? wind}${['一', '二', '三', '四'][round - 1] ?? round}局`;
}
function Payments({ output }: { output: SettlementOutput }) {
  return <div className="payment-list">{output.perSeat.map((seat) => <div className="payment-row" key={seat.seatNo}>
    <span>{winds[seat.seatNo]}家</span><strong className={seat.netPoints > 0 ? 'gain' : seat.netPoints < 0 ? 'loss' : ''}>{seat.netPoints > 0 ? '+' : ''}{pointText(seat.netPoints)}</strong>
    <small>{seat.breakdown.map((part) => `${part.reason} ${part.amount > 0 ? '+' : ''}${pointText(part.amount)}`).join(' · ')}</small>
  </div>)}</div>;
}

export default function LocalTable() {
  const { id } = useParams();
  const [match, setMatch] = useState<LocalMatch | null>(() => {
    try { return id ? getLocalMatch(id) : null; } catch { return null; }
  });
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(false);
  const [kind, setKind] = useState<'ron' | 'tsumo' | 'ryuukyoku' | 'nagashi_mangan'>('ron');
  const [winner, setWinner] = useState(0);
  const [dealIn, setDealIn] = useState(1);
  const [han, setHan] = useState(2);
  const [fu, setFu] = useState(30);
  const [tenpai, setTenpai] = useState<Record<number, boolean>>({});
  const [nagashiRiver, setNagashiRiver] = useState('');
  const [nagashiAttested, setNagashiAttested] = useState(false);
  const [preview, setPreview] = useState<{ key: string; output: SettlementOutput } | null>(null);
  const [terminal, setTerminal] = useState<TerminalSettlementOutput | null>(null);
  useEffect(() => {
    const refresh = () => {
      try { setMatch(id ? getLocalMatch(id) : null); setError(''); }
      catch (cause) { setMatch(null); setError(errorText(cause)); }
      setPreview(null); setTerminal(null); setDialog(false);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === LOCAL_MATCHES_STORAGE_KEY || event.key === null)) refresh();
    };
    refresh();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [id]);
  const hand = match?.currentHand;
  const nagashiEnabled = match?.rulesSnapshot.config.nagashiManganEnabled === true;
  const nagashiTiles = nagashiRiver.trim().split(/[\s,，]+/).filter(Boolean);
  const input: ResultInput = kind === 'ryuukyoku'
    ? { kind, winners: [], tenpai: match?.seats.map((seat) => !!tenpai[seat.seatNo]) ?? [] }
    : kind === 'nagashi_mangan'
      ? { kind, winners: [{ seatNo: winner, han: 5, fu: 30 }],
        tenpai: match?.seats.map((seat) => !!tenpai[seat.seatNo]) ?? [],
        nagashiEligibility: [{ seatNo: winner, discards: nagashiTiles.map((tile) => ({ tile, called: false })) }] }
      : { kind, winners: [{ seatNo: winner, han, fu, ...(kind === 'ron' ? { dealInSeatNo: dealIn } : {}) }] };
  const previewKey = `${hand?.handId}:${hand?.markRevision}:${JSON.stringify(input)}`;
  const shownPreview = preview?.key === previewKey ? preview.output : null;
  const invalid = kind !== 'ryuukyoku' && (kind === 'nagashi_mangan'
    ? !nagashiEnabled || !nagashiAttested || nagashiTiles.length === 0 || nagashiTiles.some((tile) => !/^(?:[19][mps]|[1-7]z)$/.test(tile))
    : !Number.isInteger(han) || han < 1 || !Number.isInteger(fu) || fu < 20 ||
      (kind === 'ron' && winner === dealIn));
  function mutate(change: (current: LocalMatch) => LocalMatch): boolean {
    if (!id) return false;
    try {
      const updated = updateLocalMatch(id, change);
      setMatch(updated); setPreview(null); setTerminal(null); setError('');
      return true;
    } catch (cause) {
      setPreview(null); setTerminal(null);
      try { setMatch(getLocalMatch(id)); } catch { setMatch(null); }
      setError(errorText(cause));
      return false;
    }
  }
  if (!match) return <main className="page table-page"><h1>本地牌局不可读取</h1>{error && <div className="notice invalid" role="alert">{error}</div>}<p>牌局可能已删除，或此浏览器没有该牌局数据。</p><Link className="button" to="/history">返回本地战绩</Link></main>;
  const status = match.status === 'active' ? '牌局进行中' : '牌局已结束';
  const shownTerminal = terminal ?? match.terminal;
  const seed = LOCAL_SEEDS.find((item) => item.key === match.seedKey);
  const ruleInfo = ruleSummary(match.templateName ?? seed?.name ?? match.name, seed ? seedRules(seed) : null, match.rules);
  const displayDealerSeatNo = (hand ?? match.nextHand)?.dealerSeatNo ?? match.results[0]?.hand.dealerSeatNo ?? 0;
  return <main className="page table-page local-table">
    <div className="table-heading"><div><p className="eyebrow">LOCAL TABLE / 本地牌桌</p><h1>{match.name}</h1><p className="muted">{status} · <span role="status">仅保存在此设备 · 离线可用</span></p><p className="rule-detail">{ruleInfo.title}{ruleInfo.changes.length ? ` · ${ruleInfo.changes.join('、')}` : ''}</p></div><Link className="button" to="/history">对局记录 →</Link></div>
    {error && <div className="notice invalid" role="alert">{error}</div>}
    <section className="panel table-checkin table-checkin-owner"><div className="section-heading"><span>座次与玩家</span><small>在此设备输入姓名，无需签到或联网</small></div>
      <div className="member-list">{match.seats.map((seat) => <div key={seat.seatNo}><span className="wind-badge">{seat.seatNo + 1}</span><label>座位 {seat.seatNo + 1}<input aria-label={`座位 ${seat.seatNo + 1} 玩家姓名`} value={seat.displayName} maxLength={40} onChange={(event) => { const displayName = event.target.value; mutate((current) => ({ ...current, seats: current.seats.map((value) => value.seatNo === seat.seatNo ? { ...value, displayName } : value) })); }} /></label><small>本地玩家</small></div>)}</div>
    </section>
    <div className="table-layout"><section className="felt" aria-label="牌桌座位"><div className="felt-lines" aria-hidden="true" /><div className="seat-grid">{match.seats.map((seat) => {
      const inHand = hand?.seats.find((value) => value.seatNo === seat.seatNo);
      return <article className={`seat seat-${seat.seatNo}`} key={seat.seatNo}><div className="seat-top"><span className="wind-badge">{winds[(seat.seatNo - displayDealerSeatNo + match.seats.length) % match.seats.length]}</span><span className="seat-name">{seat.displayName || `座位 ${seat.seatNo + 1}`}{hand?.dealerSeatNo === seat.seatNo && <em>庄家</em>}</span></div>
        <strong>{pointText(match.points[seat.seatNo])}</strong>{hand && inHand && <><div className="riichi-actions"><button type="button" className={inHand.isRiichi ? 'riichi marked' : 'riichi'} disabled={inHand.isRiichi || inHand.riichiChangeUsage.declares >= 2 || (inHand.points < 1000 && match.rulesSnapshot.config.allowLowPointRiichi !== true)} onClick={() => mutate((current) => markLocalRiichi(current, seat.seatNo))}>宣言</button><button type="button" className="riichi" disabled={!inHand.isRiichi || inHand.riichiChangeUsage.cancels >= 1} onClick={() => mutate((current) => markLocalRiichi(current, seat.seatNo))}>取消</button></div><small className="seat-status">还可立直 {Math.max(0, 2 - inHand.riichiChangeUsage.declares)} 次 · 还可取消 {Math.max(0, 1 - inHand.riichiChangeUsage.cancels)} 次</small></>}
      </article>;
    })}<div className="table-center">{hand || match.nextHand ? <><span>{roundText((hand ?? match.nextHand)!.roundWind, (hand ?? match.nextHand)!.roundNumber)}</span><b>{(hand ?? match.nextHand)!.honba} 本场</b><small>供托 {((hand ?? match.nextHand)!.riichiPool / 1000)} 根</small></> : <span>待开下一局</span>}</div></div></section>
      <aside className="panel table-aside"><h2>牌局操作</h2><div className="aside-stat"><span>牌桌状态</span><b>{status}</b></div>{hand && <div className="aside-stat"><span>立直标记版本</span><b>{hand.markRevision}</b></div>}
        <p className="note">所有牌局信息只保存在当前浏览器；立直点数会在确认本局结果时结算。清除浏览器数据将丢失记录。</p>
        {match.status === 'active' && !hand && <button type="button" className="primary" onClick={() => mutate(openLocalHand)}>新开一局</button>}
        {match.status === 'active' && hand && <button type="button" className="primary" onClick={() => { setPreview(null); setError(''); setDialog(true); }}>录入本局结果 →</button>}
        {match.status === 'active' && match.rulesSnapshot.config.automaticEndPolicy !== 'ranked_sanma' && <button type="button" onClick={() => {
          if (hand && !window.confirm('当前局尚未结算；终局将作废本局及其立直标记。确定终局？')) return;
          mutate(finishLocalMatch);
        }}>终局</button>}
        {match.status === 'finished' && <><button type="button" onClick={() => { try { setTerminal(previewLocalTerminal(match)); setError(''); } catch (cause) { setError(errorText(cause)); } }}>预览终局成绩</button>
          {shownTerminal?.isGameEnd && <><div className="payment-list">{shownTerminal.perSeat.map((result) => <div className="payment-row" key={result.seatNo}><span>{winds[result.seatNo]}家 · {match.seats[result.seatNo]?.displayName}</span><strong>{(result.totalTenths / 10).toFixed(1)}</strong><small>第 {result.rank} 名 · {pointText(result.finalPoints)} 点</small></div>)}</div><button type="button" className="primary" disabled={match.settlementConfirmed} onClick={() => mutate(confirmLocalTerminal)}>{match.settlementConfirmed ? '终局已确认' : '确认终局成绩'}</button></>}
          {match.settlementConfirmed && <p className="notice" role="status">终局成绩已保存在本地。</p>}
        </>}
        {match.results.length > 0 && <details><summary>已结算 {match.results.length} 局</summary>{match.results.map((result) => <div className="rule-detail" key={result.hand.handId}>{roundText(result.hand.roundWind, result.hand.roundNumber)} · {result.input.kind} · {new Date(result.settledAt).toLocaleString('zh-CN')}<Payments output={result.output} /></div>)}</details>}
      </aside></div>
    {dialog && hand && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(false); }}><section className="dialog panel" role="dialog" aria-modal="true" aria-label="录入结算"><div className="dialog-head"><div><p className="eyebrow">SETTLEMENT / 本局结算</p><h2>支付确认</h2></div><button type="button" className="close" aria-label="关闭" onClick={() => setDialog(false)}>×</button></div>
      <p className="muted">由此设备内置结算引擎计算；立直标记或输入变化后请重新预览。</p><Segmented label="结果类型" value={kind} options={([
        { value: 'ron', label: '荣和' }, { value: 'tsumo', label: '自摸' },
        { value: 'ryuukyoku', label: '荒牌流局' }, ...(nagashiEnabled ? [{ value: 'nagashi_mangan' as const, label: '流局满贯' }] : []),
      ] as const)} onChange={(value) => { setKind(value); setError(''); }} />
      {kind === 'ryuukyoku' ? <div className="tenpai-grid">{match.seats.map((seat) => <label className="toggle" key={seat.seatNo}><span>{winds[seat.seatNo]}家听牌</span><input type="checkbox" checked={!!tenpai[seat.seatNo]} onChange={(event) => setTenpai((current) => ({ ...current, [seat.seatNo]: event.target.checked }))} /></label>)}</div> : <div className="field-grid"><label>{kind === 'nagashi_mangan' ? '流局满贯座位' : '和牌座位'}<select value={winner} onChange={(event) => setWinner(Number(event.target.value))}>{match.seats.map((seat) => <option key={seat.seatNo} value={seat.seatNo}>{winds[seat.seatNo]}家 · {seat.displayName}</option>)}</select></label>{kind === 'ron' && <label>放铳座位<select value={dealIn} onChange={(event) => setDealIn(Number(event.target.value))}>{match.seats.map((seat) => <option key={seat.seatNo} value={seat.seatNo}>{winds[seat.seatNo]}家 · {seat.displayName}</option>)}</select></label>}{kind === 'nagashi_mangan' ? <><label>完整弃牌（逗号或空格分隔，例如 1m 9p 1z）<input value={nagashiRiver} onChange={(event) => setNagashiRiver(event.target.value)} /></label><label className="toggle"><input type="checkbox" checked={nagashiAttested} onChange={(event) => setNagashiAttested(event.target.checked)} />确认以上为全部弃牌，均为幺九且未被他家鸣走</label></> : <><label>番<input type="number" min={1} value={han} onChange={(event) => setHan(Number(event.target.value))} /></label><label>符<input type="number" min={20} step={10} value={fu} onChange={(event) => setFu(Number(event.target.value))} /></label></>}</div>}
      {kind === 'nagashi_mangan' && <div className="tenpai-grid">{match.seats.map((seat) => <label className="toggle" key={seat.seatNo}><span>{winds[seat.seatNo]}家听牌（庄家听牌连庄）</span><input type="checkbox" checked={!!tenpai[seat.seatNo]} onChange={(event) => setTenpai((current) => ({ ...current, [seat.seatNo]: event.target.checked }))} /></label>)}</div>}
      {invalid && <div className="notice invalid" role="alert">{kind === 'nagashi_mangan' ? '请填写完整的未被鸣走的幺九弃牌，并确认记录完整。' : '请输入有效座位与番符；荣和的胜者与放铳者不可相同。'}</div>}
      {shownPreview && <><h3>逐座支付</h3><Payments output={shownPreview} /><p className="rule-detail">下一局：{roundText(shownPreview.nextHand.roundWind, shownPreview.nextHand.roundNumber)} · 庄家 {winds[shownPreview.nextHand.dealerSeatNo]} · {shownPreview.nextHand.honba} 本场 · 供托 {shownPreview.nextHand.riichiPool / 1000} 根</p></>}
      {error && <div className="notice invalid" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" onClick={() => setDialog(false)}>取消</button><button type="button" disabled={invalid} onClick={() => { try { setPreview({ key: previewKey, output: previewLocalHand(match, input) }); setError(''); } catch (cause) { setPreview(null); setError(errorText(cause)); } }}>本地预览支付</button><button type="button" className="primary" disabled={invalid || !shownPreview} onClick={() => { if (mutate((current) => {
        if (!current.currentHand || current.currentHand.handId !== hand.handId ||
          current.currentHand.markRevision !== hand.markRevision) {
          throw new Error('本局已在其他窗口更新；请重新预览支付。');
        }
        return settleLocalHand(current, input);
      })) { setDialog(false); setTenpai({}); } }}>确认并结算</button></div>
    </section></div>}
  </main>;
}
