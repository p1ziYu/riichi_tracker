import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, post } from '../api';
import { errorTextZh } from '../errors';
import { PASSWORD_HINT } from '../passwordRules';
import type { Me } from '../types';
import { Notice } from './ui';

type Message = { ok: boolean; text: string };

export default function Account({ me, onUpdated }: { me: Me; onUpdated: (me: Me) => void }) {
  const [displayName, setDisplayName] = useState(me.principal.displayName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState<Message | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState<Message | null>(null);

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

    <p><Link className="text-button" to="/">回大厅 →</Link></p>
  </main>;
}
