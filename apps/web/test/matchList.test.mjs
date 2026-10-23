import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  ssr: {
    resolve: {
      conditions: ['import', 'module', 'browser', 'default'],
      externalConditions: ['import', 'module', 'browser', 'default'],
    },
  },
});
const [{ MatchList }] = await Promise.all([
  vite.ssrLoadModule('/src/App.tsx'),
]);

test.after(async () => { await vite.close(); });

function renderMatchList(initialMatches, initialShowHidden = false) {
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, null,
      React.createElement(MatchList, { initialMatches, initialShowHidden }),
    ),
  );
}

test('MatchList renders appropriate action buttons per row state and ownership', () => {
  const matches = [
    {
      id: 'match-owner-unfin',
      status: 'lobby',
      playerCount: 4,
      createdAt: new Date().toISOString(),
      isOwner: true,
      hidden: false,
    },
    {
      id: 'match-guest-unfin',
      status: 'preparing',
      playerCount: 4,
      createdAt: new Date().toISOString(),
      isOwner: false,
      hidden: false,
    },
    {
      id: 'match-finished',
      status: 'finished',
      playerCount: 4,
      createdAt: new Date().toISOString(),
      isOwner: false,
      hidden: false,
    },
    {
      id: 'match-in-progress',
      status: 'in_progress',
      playerCount: 4,
      createdAt: new Date().toISOString(),
      isOwner: true,
      hidden: false,
    },
  ];

  const html = renderMatchList(matches, false);

  // 1. Owner + unfinalized -> renders 「删除」 button with danger tint
  assert.match(html, /牌桌 match-owner-unfin/);
  assert.match(html, /<button[^>]*class="[^"]*text-button[^"]*danger[^"]*"[^>]*>删除<\/button>/);

  // 2. Guest + unfinalized -> renders 「移除」 button
  assert.match(html, /牌桌 match-guest-unfin/);
  assert.match(html, /<button[^>]*class="text-button"[^>]*>移除<\/button>/);

  // 3. Finished -> renders 「隐藏」 button
  assert.match(html, /牌桌 match-finished/);
  assert.match(html, /<button[^>]*class="text-button"[^>]*>隐藏<\/button>/);

  // 4. In-progress -> no action button
  assert.match(html, /牌桌 match-in-progress/);
  const inProgressSection = html.slice(html.indexOf('match-in-progress'));
  const nextSectionIndex = inProgressSection.indexOf('history-row', 20);
  const inProgressHtml = nextSectionIndex > 0 ? inProgressSection.slice(0, nextSectionIndex) : inProgressSection;
  assert.doesNotMatch(inProgressHtml, /<button[^>]*>删除<\/button>/);
  assert.doesNotMatch(inProgressHtml, /<button[^>]*>移除<\/button>/);
  assert.doesNotMatch(inProgressHtml, /<button[^>]*>隐藏<\/button>/);
});

test('MatchList toggle reveals hidden rows with 已隐藏 tag and 取消隐藏 button', () => {
  const matches = [
    {
      id: 'match-hidden-one',
      status: 'finished',
      playerCount: 4,
      createdAt: new Date().toISOString(),
      isOwner: true,
      hidden: true,
    },
  ];

  const html = renderMatchList(matches, true);

  // Toggle button has aria-pressed="true"
  assert.match(html, /<button[^>]*aria-pressed="true"[^>]*>显示已隐藏<\/button>/);

  // Hidden row renders 「已隐藏」 tag and 「取消隐藏」 button
  assert.match(html, /<span class="tag">已隐藏<\/span>/);
  assert.match(html, /<button[^>]*class="text-button"[^>]*>取消隐藏<\/button>/);
});
