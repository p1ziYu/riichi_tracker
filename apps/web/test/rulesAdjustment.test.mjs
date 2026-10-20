import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const [{ default: RulesAdjustment }, { seedRules, LOCAL_SEEDS }] = await Promise.all([
  vite.ssrLoadModule('/src/RulesAdjustment.tsx'),
  vite.ssrLoadModule('/src/localMatches.ts'),
]);

test.after(async () => { await vite.close(); });

function rendered(base, rules) {
  return renderToStaticMarkup(React.createElement(RulesAdjustment, {
    base, rules, onChange: () => {},
  }));
}

test('shared adjustment starts collapsed with template values and enabled policy selected', () => {
  const base = seedRules(LOCAL_SEEDS[0]);
  const html = rendered(base, base);
  assert.match(html, /<details class="panel rules-adjustment">/);
  assert.match(html, /规则调整 <strong>已按模板<\/strong>/);
  assert.match(html, /aria-label="切上满贯"><button[^>]*aria-pressed="true"[^>]*>开启<\/button>/);
  assert.match(html, /aria-label="多家荣和"><button[^>]*aria-pressed="true"[^>]*>头跳<\/button>/);
  assert.match(html, /aria-label="马点预设"/);
  assert.match(html, /1 位马点<input type="number" step="0.1" value="15"/);
});

test('diff count and reset/switch props render the current template rather than prior edits', () => {
  const wrc = seedRules(LOCAL_SEEDS[0]);
  const edited = { ...wrc, multiRon: 'double_ron', kiriageMangan: false,
    uma: [30, 10, -10, -30] };
  const changed = rendered(wrc, edited);
  assert.match(changed, /已自定义 3 项/);
  assert.match(changed, /aria-label="多家荣和"><button[^>]*aria-pressed="false"[^>]*>头跳<\/button><button[^>]*aria-pressed="true"[^>]*>双响<\/button>/);
  assert.match(changed, /恢复模板默认规则<\/button>/);
  assert.match(rendered(wrc, { ...wrc, uma: [...wrc.uma] }), /已按模板/);
  const sanma = seedRules(LOCAL_SEEDS[1]);
  const switched = rendered(sanma, sanma);
  assert.match(switched, /已按模板/);
  assert.match(switched, /起始点<input type="number" step="100" inputMode="numeric" value="35000"/);
  assert.doesNotMatch(switched, /4 位马点<input/);
});
