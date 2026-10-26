import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, post } from '../api';
import { errorTextZh } from '../errors';
import { PASSWORD_HINT } from '../passwordRules';
import type { Me } from '../types';
import Segmented from '../Segmented';
import { Notice } from './ui';

function safeReturnTo(value: string | null): string {
  if (value && value.startsWith('/') && !value.startsWith('//') && value !== '/login') return value;
  return '/';
}

export default function Login({ onAuthenticated }: { onAuthenticated: (me: Me) => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function enter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post(mode === 'login' ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email',
        mode === 'login' ? { email, password } : { email, password, name });
      const me = await api<Me>('/api/me');
      onAuthenticated(me);
      navigate(returnTo, { replace: true });
    } catch (cause) {
      setError(errorTextZh(cause));
    } finally {
      setBusy(false);
    }
  }

  return <main className="page narrow">
    <p className="eyebrow">ACCOUNT / 账户</p>
    <h1>登录一姬</h1>
    <section className="panel">
      <Segmented label="登录方式" value={mode}
        options={[{ value: 'login', label: '邮箱登录' }, { value: 'register', label: '注册账户' }]}
        onChange={setMode} />
      <form onSubmit={(event) => void enter(event)}>
        {mode === 'register' && <label>昵称
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
        </label>}
        <label>邮箱
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required />
        </label>
        <label>密码
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
        </label>
        {mode === 'register' && <small className="muted">{PASSWORD_HINT}</small>}
        <button className="primary" type="submit" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}</button>
      </form>
      {error && <Notice invalid>{error}</Notice>}
      <p className="note login-note">登录后可开桌、加入牌局并查看自己的对局记录。牌局分享链接会先要求登录，再直接加入。</p>
    </section>
  </main>;
}
