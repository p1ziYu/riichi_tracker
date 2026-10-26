import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError, api, post } from './api';
import { errorTextZh } from './errors';
import type { Me } from './types';
import BottomTabs from './BottomTabs';
import Admin from './screens/Admin';
import Create from './screens/Create';
import History from './screens/History';
import Home from './screens/Home';
import Join from './screens/Join';
import Login from './screens/Login';
import Share from './screens/Share';
import TablePage from './screens/TablePage';
import { Notice } from './screens/ui';
import './style.css';

function Shell({ me, children }: { me: Me | null; children: React.ReactNode }) {
  return <div className="app-shell">
    <header className="topbar">
      <Link to="/" className="brand"><span className="brand-tile">東</span><span>一姬<span className="brand-sub"> / ICHIHIME</span></span></Link>
    </header>
    {children}
    <footer className="footer">一姬 / ICHIHIME · 记录每一场半庄{me?.isAdmin ? ' · 管理员' : ''}</footer>
    <BottomTabs signedIn={!!me} />
  </div>;
}

function Protected({ me, children }: { me: Me | null; children: React.ReactNode }) {
  const location = useLocation();
  if (me) return <>{children}</>;
  const returnTo = `${location.pathname}${location.search}`;
  return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
}

function LoginRoute({ me, onAuthenticated, onLogout, logoutError }: {
  me: Me | null;
  onAuthenticated: (value: Me) => void;
  onLogout: () => void;
  logoutError: string;
}) {
  if (!me) return <Login onAuthenticated={onAuthenticated} />;
  return <main className="page narrow">
    <p className="eyebrow">ACCOUNT / 账户</p>
    <h1>我的一姬</h1>
    <section className="panel">
      <h2>{me.principal.displayName}</h2>
      <p className="muted">账户与牌局记录</p>
      <p><Link className="button" to="/history">查看战绩 →</Link></p>
      {me.isAdmin && <p><Link className="button" to="/admin">玩家管理与数据管理 →</Link></p>}
      <p><button type="button" className="text-button" onClick={onLogout}>退出登录</button></p>
      {logoutError && <Notice invalid>退出登录失败：{logoutError}，请重试。</Notice>}
    </section>
  </main>;
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [logoutError, setLogoutError] = useState('');

  useEffect(() => {
    let alive = true;
    api<Me>('/api/me').then((data) => {
      if (alive) setMe(data);
    }).catch((cause: unknown) => {
      if (!alive) return;
      if (cause instanceof ApiError && cause.status === 401) setMe(null);
      else setAuthError(errorTextZh(cause));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function logout() {
    setLogoutError('');
    try {
      await post('/api/auth/sign-out');
    } catch (cause) {
      setLogoutError(errorTextZh(cause));
      return;
    }
    setMe(null);
    window.location.assign('/login');
  }

  return <BrowserRouter><Shell me={me}>
    {loading ? <main className="page">正在验证身份…</main>
      : authError ? <main className="page narrow">
        <Notice invalid>身份验证失败：{authError}</Notice>
        <button type="button" onClick={() => window.location.reload()}>重试</button>
      </main>
      : <Routes>
        <Route path="/login" element={<LoginRoute me={me} onAuthenticated={setMe} onLogout={() => void logout()} logoutError={logoutError} />} />
        <Route path="/" element={<Protected me={me}><Home /></Protected>} />
        <Route path="/create" element={<Protected me={me}><Create /></Protected>} />
        <Route path="/share/:id" element={<Protected me={me}><Share /></Protected>} />
        <Route path="/table/:id" element={<Protected me={me}>{me && <TablePage me={me} />}</Protected>} />
        <Route path="/history" element={<Protected me={me}>{me && <History me={me} />}</Protected>} />
        <Route path="/admin" element={<Protected me={me}>{me && <Admin me={me} />}</Protected>} />
        <Route path="/checkin/:matchId" element={<Protected me={me}><Join /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>}
  </Shell></BrowserRouter>;
}
