import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, post } from '../api';
import { errorTextZh } from '../errors';
import { PASSWORD_HINT } from '../passwordRules';
import type { Me } from '../types';
import { Notice } from './ui';

type Message = { ok: boolean; text: string };

export default function Account({ me, onUpdated, onLogout, onDeleted, logoutError }: {
  me: Me; onUpdated: (me: Me) => void; onLogout: () => void; onDeleted: () => void; logoutError: string;
}) {
  const [displayName, setDisplayName] = useState(me.principal.displayName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState<Message | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState<Message | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameBusy(true);
    setNameMessage(null);
    try {
      const next = await api<Me>('/api/me/display-name', {
        method: 'PATCH',
        body: JSON.stringify({ displayName }),
      });
      onUpdated(next);
      setNameMessage({ ok: true, text: '显示名字已更新' });
    } catch (cause) {
      setNameMessage({ ok: false, text: errorTextZh(cause) });
    } finally {
      setNameBusy(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setPwMessage({ ok: false, text: '两次输入的新密码不一致' });
      return;
    }
    setPwBusy(true);
    setPwMessage(null);
    try {
      await post('/api/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwMessage({ ok: true, text: '密码已修改' });
    } catch (cause) {
      setPwMessage({ ok: false, text: errorTextZh(cause) });
    } finally {
      setPwBusy(false);
    }
  }

  async function deleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await post('/api/me/delete-account', { currentPassword: deletePassword, confirmed: true });
      setDeletePassword('');
      try {
        await post('/api/auth/sign-out');
      } catch {
        // The auth user and all sessions were already removed by the deletion.
      }
      onDeleted();
    } catch (cause) {
      setDeleteError(errorTextZh(cause));
    } finally {
      setDeleteBusy(false);
    }
  }

  return <main className="page narrow">
    <p className="eyebrow">ACCOUNT / 账户</p>
    <h1>账户设置</h1>

    <section className="panel">
      <h2>显示名字</h2>
      <p className="muted">这个名字会显示在对局成员与战绩里。</p>
      <form onSubmit={(event) => void saveName(event)}>
        <label>显示名字
          <input value={displayName} maxLength={64} onChange={(event) => setDisplayName(event.target.value)} required />
        </label>
        <button className="primary" type="submit" disabled={nameBusy}>{nameBusy ? '请稍候…' : '保存'}</button>
      </form>
      {nameMessage && <Notice invalid={!nameMessage.ok}>{nameMessage.text}</Notice>}
    </section>

    <section className="panel">
      <h2>修改密码</h2>
      <p className="muted">输入当前密码和新密码，确认后生效。</p>
      <form onSubmit={(event) => void changePassword(event)}>
        <label>当前密码
          <input type="password" value={currentPassword} autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} required />
        </label>
        <label>新密码
          <input type="password" value={newPassword} autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} required />
        </label>
        <small className="muted">{PASSWORD_HINT}</small>
        <label>确认新密码
          <input type="password" value={confirmPassword} autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} required />
        </label>
        <button className="primary" type="submit" disabled={pwBusy}>{pwBusy ? '请稍候…' : '修改密码'}</button>
      </form>
      {pwMessage && <Notice invalid={!pwMessage.ok}>{pwMessage.text}</Notice>}
    </section>

    <section className="panel">
      <h2>账户操作</h2>
      <div className="account-actions">
        <button type="button" onClick={onLogout}>退出</button>
        <button type="button" className="danger" onClick={() => { setConfirmingDelete(true); setDeleteError(''); }}>注销账户</button>
      </div>
      {logoutError && <Notice invalid>退出登录失败：{logoutError}，请重试。</Notice>}
      {confirmingDelete && <div className="account-delete-confirm">
        <p className="muted">注销账户不可逆；注销后立即退出登录。历史对局记录保留，过去对局中的名字将显示为已注销玩家。</p>
        <form onSubmit={(event) => void deleteAccount(event)}>
          <label>当前密码
            <input type="password" autoComplete="current-password" value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)} required />
          </label>
          <div className="account-actions">
            <button type="submit" className="danger" disabled={deleteBusy}>{deleteBusy ? '正在注销…' : '确认注销账户'}</button>
            <button type="button" disabled={deleteBusy} onClick={() => { setConfirmingDelete(false); setDeletePassword(''); setDeleteError(''); }}>取消</button>
          </div>
        </form>
        {deleteError && <Notice invalid>{deleteError}</Notice>}
      </div>}
    </section>

    <p><Link className="text-button" to="/">回大厅 →</Link></p>
  </main>;
}
