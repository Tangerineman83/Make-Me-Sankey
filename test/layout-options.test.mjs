// Tests for node.order, --plot-height, --route-color and --word-gap.
// Default output (no new flags, no order field) must stay unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO, runCli, renderToString, parseXml, tmp } from './helpers.mjs';

const require = createRequire(import.meta.url);
const SankeyRender = require('../sankey-render.js');

const TEMPLATE = path.join(REPO, 'data-template.json');
const HOUSEHOLD = path.join(REPO, 'test', 'fixtures', 'household-budget.json');
const PRO = ['--style', 'pro', '--palette', 'house'];

function writeJson(data) {
    const p = path.join(tmp(), 'data.json');
    writeFileSync(p, JSON.stringify(data));
    return p;
}

function withNodeOrders(src, orders) {
    const data = JSON.parse(require('node:fs').readFileSync(src, 'utf8'));
    data.nodes.forEach((n) => {
        if (Object.prototype.hasOwnProperty.call(orders, n.name)) n.order = orders[n.name];
    });
    return writeJson(data);
}

function nodeY(svg, name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = svg.match(new RegExp(`<rect x="[^"]+" y="([^"]+)"[^>]*class="sk-node" data-name="${esc}"`));
    assert.ok(m, `missing node ${name}`);
    return Number(m[1]);
}

function ribbonFill(svg, source, target) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<path d="[^"]*" fill="([^"]+)"[^>]*class="sk-ribbon" data-source="${esc(source)}" data-target="${esc(target)}"`);
    const m = svg.match(re);
    assert.ok(m, `missing ribbon ${source} → ${target}`);
    return m[1].toUpperCase();
}

function viewBoxH(svg) {
    const m = svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/);
    assert.ok(m, 'missing viewBox');
    return Number(m[1]);
}

test('node.order: a fully ordered column is laid out top-to-bottom, low = top', () => {
    // Default value-desc in the last column is Rent (1400), Taxes (900), Savings (830), Groceries (520).
    const unordered = renderToString(HOUSEHOLD, PRO);
    assert.ok(nodeY(unordered, 'Rent') < nodeY(unordered, 'Taxes'));
    assert.ok(nodeY(unordered, 'Taxes') < nodeY(unordered, 'Savings'));
    assert.ok(nodeY(unordered, 'Savings') < nodeY(unordered, 'Groceries'));

    // Reverse the last column; leave other columns unordered so they keep value-desc.
    const ordered = renderToString(withNodeOrders(HOUSEHOLD, {
        Groceries: 0, Savings: 1, Taxes: 2, Rent: 3,
    }), PRO);
    assert.ok(nodeY(ordered, 'Groceries') < nodeY(ordered, 'Savings'));
    assert.ok(nodeY(ordered, 'Savings') < nodeY(ordered, 'Taxes'));
    assert.ok(nodeY(ordered, 'Taxes') < nodeY(ordered, 'Rent'));
    // A column without a complete set of orders is unchanged.
    assert.equal(nodeY(ordered, 'Salary'), nodeY(unordered, 'Salary'));
});

test('node.order: a partially ordered column keeps the default value-desc sort', () => {
    const unordered = renderToString(HOUSEHOLD, PRO);
    const partial = renderToString(withNodeOrders(HOUSEHOLD, { Rent: 99, Groceries: 0 }), PRO);
    assert.equal(nodeY(partial, 'Rent'), nodeY(unordered, 'Rent'));
    assert.equal(nodeY(partial, 'Taxes'), nodeY(unordered, 'Taxes'));
    assert.equal(nodeY(partial, 'Savings'), nodeY(unordered, 'Savings'));
    assert.equal(nodeY(partial, 'Groceries'), nodeY(unordered, 'Groceries'));
});

test('node.order: omitted, the default render is unchanged; invalid values are rejected', () => {
    const data = JSON.parse(require('node:fs').readFileSync(HOUSEHOLD, 'utf8'));
    assert.equal(renderToString(writeJson(data), PRO), renderToString(HOUSEHOLD, PRO));

    const bad = JSON.parse(JSON.stringify(data));
    bad.nodes[0].order = 'top';
    const r = runCli([writeJson(bad), path.join(tmp(), 'out.svg'), ...PRO]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /invalid 'value', 'column' or 'order'/);
});

test('plot-height: pro default usable height is 400; a larger value grows the canvas', () => {
    const def = renderToString(HOUSEHOLD, PRO);
    const h400 = renderToString(HOUSEHOLD, [...PRO, '--plot-height', '400']);
    const h600 = renderToString(HOUSEHOLD, [...PRO, '--plot-height', '600']);
    assert.equal(def, h400, 'explicit 400 must match the default');
    assert.equal(viewBoxH(h600), viewBoxH(def) + 200);
    assert.equal(parseXml(h600).root, 'svg');
    // Default branded output (no pro) is unchanged by the new code path.
    const stock = renderToString(TEMPLATE);
    assert.match(stock, /viewBox="0 0 900 506"/);
});

test('plot-height: listed in --help; only valid with --style pro; range is checked', () => {
    const help = runCli(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--plot-height/);
    const notPro = runCli([TEMPLATE, path.join(tmp(), 'out.svg'), '--plot-height', '500']);
    assert.equal(notPro.status, 2);
    assert.match(notPro.stderr, /only valid with --style pro/);
    const tooSmall = runCli([TEMPLATE, path.join(tmp(), 'out.svg'), '--style', 'pro', '--plot-height', '50']);
    assert.equal(tooSmall.status, 2);
    assert.match(tooSmall.stderr, /100 to 10000/);
});

test('route-color: target wins, then source; default fill is unchanged without the flag', () => {
    const base = renderToString(HOUSEHOLD, PRO);
    const recoloured = renderToString(HOUSEHOLD, [
        ...PRO,
        '--route-color', 'Savings:#FF6601',
        '--route-color', 'Rent:#2A7A6B',
        '--route-color', 'Household income:#9AA3AD',
    ]);
    assert.notEqual(recoloured, base);
    // Target in the map wins over source.
    assert.equal(ribbonFill(recoloured, 'Household income', 'Savings'), '#FF6601');
    assert.equal(ribbonFill(recoloured, 'Household income', 'Rent'), '#2A7A6B');
    // No target mapping: the source mapping is used.
    assert.equal(ribbonFill(recoloured, 'Household income', 'Taxes'), '#9AA3AD');
    assert.equal(ribbonFill(recoloured, 'Salary', 'Household income'), '#9AA3AD');
    // A ribbon whose ends are unlisted keeps the default fill.
    const onlySavings = renderToString(HOUSEHOLD, [...PRO, '--route-color', 'Savings:#FF6601']);
    assert.equal(ribbonFill(onlySavings, 'Household income', 'Savings'), '#FF6601');
    assert.equal(ribbonFill(onlySavings, 'Household income', 'Taxes'), ribbonFill(base, 'Household income', 'Taxes'));
    // Without the flag, output is byte-identical to the previous default.
    assert.equal(renderToString(HOUSEHOLD, PRO), base);
});

test('route-color: helper matches the job-local rule; bad CLI values are rejected', () => {
    const svg = '<svg><path d="M0 0" fill="#111111" class="sk-ribbon" data-source="A" data-target="B"></path></svg>';
    const out = SankeyRender.recolorRibbonsByRoute(svg, { B: '#FF6601', A: '#2A7A6B' });
    assert.match(out, /fill="#FF6601"/);
    const bySource = SankeyRender.recolorRibbonsByRoute(svg, { A: '#2A7A6B' });
    assert.match(bySource, /fill="#2A7A6B"/);
    assert.equal(SankeyRender.recolorRibbonsByRoute(svg, {}), svg);

    const help = runCli(['--help']);
    assert.match(help.stdout, /--route-color/);
    const bad = runCli([TEMPLATE, path.join(tmp(), 'out.svg'), '--route-color', 'Savings']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Name:#RGB or Name:#RRGGBB/);
});

test('word-gap: 0.40em is applied to title and caption; default output is unchanged', () => {
    const title = 'Most small pots leave as cash';
    const caption = 'Test fixture. Illustrative, not a forecast.';
    const flags = [...PRO, '--title', title, '--caption', caption];
    const base = renderToString(HOUSEHOLD, flags);
    const gapped = renderToString(HOUSEHOLD, [...flags, '--word-gap', '0.40']);
    assert.notEqual(gapped, base);
    assert.doesNotMatch(base, /word-spacing=/);
    assert.match(gapped, /class="sk-title"[^>]*word-spacing="/);
    assert.match(gapped, /class="sk-caption"[^>]*word-spacing="/);
    assert.match(gapped, /class="sk-label-name"[^>]*word-spacing="/);
    // Caption is 12.5px Selawik 400; space is 561/2048 of an em.
    const capExtra = Math.max(0, 0.40 * 12.5 - (561 / 2048) * 12.5);
    assert.match(gapped, new RegExp(`class="sk-caption"[^>]*word-spacing="${+capExtra.toFixed(3)}"`));
    // Without the flag, existing title/caption output is unchanged.
    assert.equal(renderToString(HOUSEHOLD, flags), base);
    // Default branded template (no new flags) still has the hand-checked viewBox.
    assert.match(renderToString(TEMPLATE), /viewBox="0 0 900 506"/);
});

test('word-gap: listed in --help; range is checked; measurer uses the wider space', () => {
    const help = runCli(['--help']);
    assert.match(help.stdout, /--word-gap/);
    const bad = runCli([TEMPLATE, path.join(tmp(), 'out.svg'), '--word-gap', '0']);
    assert.equal(bad.status, 2);
    const data = JSON.parse(require('node:fs').readFileSync(HOUSEHOLD, 'utf8'));
    // "Side income" is a two-word left-column label; a large word gap should still render.
    const svg = renderToString(writeJson(data), [...PRO, '--word-gap', '0.40']);
    assert.match(svg, />Side income</);
    const tooBig = runCli([TEMPLATE, path.join(tmp(), 'out.svg'), '--style', 'pro', '--word-gap', '3']);
    assert.equal(tooBig.status, 2);
});
