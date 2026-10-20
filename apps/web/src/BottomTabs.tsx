import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

type Tab = 'lobby' | 'create' | 'history' | 'account';
const tabs: { id: Tab; to: string; label: string }[] = [
  { id: 'lobby', to: '/', label: '大厅' },
  { id: 'create', to: '/create', label: '开桌' },
  { id: 'history', to: '/history', label: '战绩' },
  { id: 'account', to: '/login', label: '登录' },
];

function TabIcon({ id }: { id: Tab }) {
  const shared = { width: 23, height: 23, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  switch (id) {
    case 'lobby': return <svg {...shared}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M9 21v-7h6v7" /></svg>;
    case 'create': return <svg {...shared}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 7v10M7 12h10" /></svg>;
    case 'history': return <svg {...shared}><path d="M4 5v5h5M4.5 10a8 8 0 1 1-.1 5" /><path d="M12 7v5l3 2" /></svg>;
    case 'account': return <svg {...shared}><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>;
  }
}

export default function BottomTabs({ signedIn }: { signedIn: boolean }) {
  const { pathname } = useLocation();
  const active = pathname === '/login' ? 'account' : pathname === '/create' || pathname.startsWith('/checkin/') ? 'create' : pathname === '/history' || pathname.startsWith('/table/') ? 'history' : 'lobby';
  const activeIndex = tabs.findIndex((tab) => tab.id === active);
  const navRef = useRef<HTMLElement>(null);
  const linksRef = useRef<(HTMLAnchorElement | null)[]>([]);
  const [pill, setPill] = useState<{ x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const link = linksRef.current[activeIndex];
    if (!nav || !link) return;
    const measure = () => {
      const navBounds = nav.getBoundingClientRect();
      const linkBounds = link.getBoundingClientRect();
      const next = { x: linkBounds.left - navBounds.left - nav.clientLeft, width: linkBounds.width };
      setPill((previous) => previous?.x === next.x && previous.width === next.width ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    linksRef.current.forEach((item) => { if (item) observer.observe(item); });
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [activeIndex]);

  return <nav ref={navRef} className="bottom-tabs" aria-label="主导航">
    <span className={`bottom-tabs-pill${pill ? ' ready' : ''}`} aria-hidden="true" style={pill ? { width: pill.width, transform: `translate3d(${pill.x}px, 0, 0)` } : undefined} />
    {tabs.map((tab, index) => <Link key={tab.id} ref={(node) => { linksRef.current[index] = node; }} className={`bottom-tab${tab.id === active ? ' active' : ''}`} to={tab.to} aria-current={pathname === tab.to ? 'page' : undefined}>
      <TabIcon id={tab.id} /><span>{tab.id === 'account' && signedIn ? '我的' : tab.label}</span>
    </Link>)}
  </nav>;
}
