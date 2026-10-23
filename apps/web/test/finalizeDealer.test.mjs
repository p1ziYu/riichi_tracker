import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
const [{ FinalizeDealerBlock }] = await Promise.all([
  vite.ssrLoadModule('/src/Table.tsx'),
]);

test.after(async () => { await vite.close(); });

test('finalize panel dealer block has helper text as its own block element under control row', () => {
  const html = renderToStaticMarkup(
    React.createElement(FinalizeDealerBlock, {
      dealerSeatNo: null,
      busy: false,
      onSelectDealer: () => {},
    }),
  );

  // Structure and scoped classes assertion
  assert.match(html, /^<div class="table-dealer-block">/);
  assert.match(html, /<div class="dealer-row"><span>起家：<\/span><button[^>]*aria-pressed="true"[^>]*>随机（默认）<\/button><\/div>/);
  assert.match(html, /<small class="dealer-helper">点击已入座玩家的座位指定东家<\/small><\/div>$/);
});
