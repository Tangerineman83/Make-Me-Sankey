// Reviewer's independent fixture (written after the build; the build tests above do not use it).
// Topology differs from both build fixtures: 5 columns, a collapsible pass-through chain
// (Pot@1 -> Pot@2, same displayName), a column-skipping link, a pinned column, a node with no
// colour, a node no link uses (must be dropped), names needing XML escaping, values >= 1,000,
// a 0.4 sliver, and an empty column label. Never edit to make pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO, renderToString, parseXml, texts, titles, decode } from './helpers.mjs';

const FX = path.join(REPO, 'test', 'review-fixtures', 'pension-flow-5col.json');

const rects = (svg) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="12" height="([\d.]+)"[^>]*data-name="([^"]*)"/g)]
    .map(m => ({ x: +m[1], y: +m[2], h: +m[3], name: decode(m[4]) }));
const ribbons = (svg) => [...svg.matchAll(/<path d="([^"]*)"[^>]*class="sk-ribbon" data-source="([^"]*)" data-target="([^"]*)"/g)]
    .map(m => { const n = m[1].match(/-?\d+(\.\d+)?/g).map(Number); return { src: decode(m[2]), tgt: decode(m[3]), sy0: n[1], ty0: n[7], ty1: n[9], sy1: n[15] }; });

test('review: renders, well-formed, byte-identical on rerun in every ribbon style', () => {
    for (const style of ['standard', 'classic', 'modern']) {
        const a = renderToString(FX, ['--style', style]);
        const b = renderToString(FX, ['--style', style]);
        assert.equal(a, b, style);
        assert.equal(parseXml(a).root, 'svg', style);
    }
});

test('review: collapsed by default — Pot@1 folds into Pot@2, five columns, unused node dropped', () => {
    const svg = renderToString(FX);
    const r = rects(svg);
    assert.ok(!r.some(n => n.name === 'Pot@1'), 'Pot@1 collapsed away');
    assert.ok(r.some(n => n.name === 'Pot@2'));
    assert.ok(!svg.includes('Unused node'), 'node with no links is dropped (as in the web app)');
    assert.equal(new Set(r.map(n => n.x)).size, 5, 'five columns');
    assert.equal(texts(svg).filter(t => t === 'Pension pot' || t === 'Pension').length, 1, 'one pot label');
    assert.ok(titles(svg).includes('Employer & Employee → Pot@2: 12,500'), 'inbound link redirected to Pot@2');
});

test('review: --expand shows both pass-through instances', () => {
    const svg = renderToString(FX, ['--expand']);
    const names = rects(svg).map(n => n.name);
    assert.ok(names.includes('Pot@1') && names.includes('Pot@2'));
    assert.ok(titles(svg).includes('Pot@1 → Pot@2: 15,000'));
});

test('review: escaping, number formatting and column labels (hand-checked)', () => {
    const svg = renderToString(FX);
    assert.match(svg, /data-name="Employer &amp; Employee"/);
    assert.match(svg, /data-name="Fees &quot;admin&quot;"/);
    const tt = titles(svg);
    assert.ok(tt.includes('Employer & Employee: 16,250'), '12,500 + 3,750 out of the source');
    assert.ok(tt.includes('Retirement income: 15,000'), '6,000 + 5,249.6 + 3,750 = 14,999.6 -> "15,000" (0 dp at >= 1,000)');
    assert.ok(tt.includes('Pot@2 → Drawdown: 5,250'), '5,249.6 rounds to 5,250');
    assert.ok(tt.includes('Pot@2 → Fees "admin": 0.4'), 'below 1,000 keeps 1 dp');
    const colLabels = [...svg.matchAll(/class="sk-col-label"[^>]*>([^<]*)</g)].map(m => m[1]);
    assert.deepEqual(colLabels, ['Contributions', 'Accumulate', 'Decumulate', 'Income'], 'empty label skipped');
});

test('review: geometry — min-height floor and flow conservation (hand-checked)', () => {
    const svg = renderToString(FX);
    const r = Object.fromEntries(rects(svg).map(n => [n.name, n]));
    // Column 3 (Annuity 6000, Drawdown 5249.6, Fees 0.4): gap = min(30, 420/3) = 30,
    // available = 446 - 60 = 386, global total = column 0 sum = 16,250 + 2,500 = 18,750.
    // Fees: 0.4/18750*386 = 0.008 px -> floored to MIN_NODE_H = 6; no overflow, so exactly 6.
    assert.equal(r['Fees "admin"'].h, 6);
    // Annuity: 6000/18750*386 = 123.52 px.
    assert.ok(Math.abs(r['Annuity'].h - 123.52) < 1e-9, `Annuity height ${r['Annuity'].h}`);
    // Ribbons into "Retirement income" stack exactly over its node (conservation).
    const ins = ribbons(svg).filter(x => x.tgt === 'Retirement income').sort((a, b) => a.ty0 - b.ty0);
    assert.equal(ins.length, 3);
    const node = r['Retirement income'];
    assert.ok(Math.abs(ins[0].ty0 - node.y) < 1e-9);
    for (let i = 1; i < ins.length; i++) assert.ok(Math.abs(ins[i].ty0 - ins[i - 1].ty1) < 1e-9, 'ribbons abut');
    assert.ok(Math.abs(ins[ins.length - 1].ty1 - (node.y + node.h)) < 1e-6, 'ribbons fill the node');
    // Source side: the two out-ribbons of Employer & Employee split its height 12,500 : 3,750.
    const outs = ribbons(svg).filter(x => x.src === 'Employer & Employee');
    const th = Object.fromEntries(outs.map(o => [o.tgt, o.sy1 - o.sy0]));
    assert.ok(Math.abs(th['Pot@2'] / th['Tax-free cash'] - 12500 / 3750) < 1e-9);
});
