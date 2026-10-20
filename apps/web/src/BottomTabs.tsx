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
  const visibleTabs = tabs;
  const routeTab = pathname === '/login' ? 'account' : pathname === '/create' || pathname.startsWith('/checkin/') ? 'create' : pathname === '/history' || pathname.startsWith('/table/') ? 'history' : 'lobby';
  const active = routeTab;
  const activeIndex = visibleTabs.findIndex((tab) => tab.id === active);
  const navRef = useRef<HTMLElement>(null);
  const linksRef = useRef<(HTMLAnchorElement | null)[]>([]);
  const [pill, setPill] = useState<{ x: number; y: number; width: number; height: number; moving: boolean } | null>(null);
  const measuredRef = useRef<{ index: number; desktop: boolean; count: number } | null>(null);

  useLayoutEffect(() => {
    linksRef.current.length = visibleTabs.length;
    const nav = navRef.current;
    const link = linksRef.current[activeIndex];
    if (!nav || !link) return;
    const measure = () => {
      const navBounds = nav.getBoundingClientRect();
      const linkBounds = link.getBoundingClientRect();
      const desktop = window.matchMedia('(min-width: 1024px)').matches;
      const next = {
        x: linkBounds.left - navBounds.left - nav.clientLeft,
        y: linkBounds.top - navBounds.top - nav.clientTop,
        width: linkBounds.width,
        height: linkBounds.height,
      };
      const last = measuredRef.current;
      const routeChange = last !== null && last.desktop === desktop && last.count === visibleTabs.length && last.index !== activeIndex;
      measuredRef.current = { index: activeIndex, desktop, count: visibleTabs.length };
      setPill((previous) =>
        previous?.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height
          ? previous
          : { ...next, moving: routeChange },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    linksRef.current.forEach((item) => { if (item) observer.observe(item); });
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [activeIndex, signedIn]);

  return <nav ref={navRef} className={`bottom-tabs${signedIn ? '' : ' signed-out'}`} aria-label="主导航">
    <Link to="/" className="sidebar-brand"><span className="brand-tile">東</span><span>一姬<span className="brand-sub"> / ICHIHIME</span></span></Link>
    <span className={`bottom-tabs-pill${pill ? ' ready' : ''}${pill?.moving ? ' moving' : ''}`} aria-hidden="true" style={pill ? { width: pill.width, height: pill.height, transform: `translate3d(${pill.x}px, ${pill.y}px, 0)` } : undefined} />
    {visibleTabs.map((tab, index) => <Link key={tab.id} ref={(node) => { linksRef.current[index] = node; }} className={`bottom-tab${tab.id === active ? ' active' : ''}`} to={tab.to} aria-current={tab.id === active ? 'page' : undefined}>
      <TabIcon id={tab.id} /><span>{tab.id === 'account' && signedIn ? '我的' : tab.label}</span>
    </Link>)}
  </nav>;
}
