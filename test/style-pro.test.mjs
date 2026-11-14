// Tests for the opt-in --style pro preset and --palette house.
// Existing styles/palettes are covered by the acceptance and review fixtures; do not edit those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO, runCli, renderToString, parseXml, texts, titles, decode } from './helpers.mjs';

const require = createRequire(import.meta.url);
const SankeyRender = require('../sankey-render.js');

const TEMPLATE = path.join(REPO, 'data-template.json');
const HOUSEHOLD = path.join(REPO, 'test', 'fixtures', 'household-budget.json');
const PENSION = path.join(REPO, 'test', 'review-fixtures', 'pension-flow-5col.json');

const PRO = ['--style', 'pro', '--palette', 'house'];

test('pro: two renders of the same JSON are byte-identical (with and without title/caption)', () => {
    const a = renderToString(HOUSEHOLD, PRO);
    const b = renderToString(HOUSEHOLD, PRO);
    assert.equal(a, b);
    assert.equal(parseXml(a).root, 'svg');
    const titled = ['--style', 'pro', '--palette', 'house', '--title', 'Household budget',
        '--caption', 'Test fixture. Illustrative, not a forecast.'];
    assert.equal(renderToString(HOUSEHOLD, titled), renderToString(HOUSEHOLD, titled));
    const p = renderToString(PENSION, PRO);
    assert.equal(p, renderToString(PENSION, PRO));
    assert.equal(parseXml(p).root, 'svg');
});

test('pro: title and caption appear only when passed, and then reserve their own space', () => {
    const bare = renderToString(HOUSEHOLD, PRO);
    const titled = renderToString(HOUSEHOLD, [...PRO, '--title', 'Household budget']);
    const captioned = renderToString(HOUSEHOLD, [...PRO, '--caption', 'Test fixture. Illustrative, not a forecast.']);
    const both = renderToString(HOUSEHOLD, [...PRO, '--title', 'Household budget',
        '--caption', 'Test fixture. Illustrative, not a forecast.']);

    assert.doesNotMatch(bare, /class="sk-title"/);
    assert.doesNotMatch(bare, /class="sk-caption"/);
    assert.ok(!texts(bare).includes('Household budget'));

    assert.match(titled, /class="sk-title"/);
    assert.ok(texts(titled).includes('Household budget'));
    assert.doesNotMatch(titled, /class="sk-caption"/);

    assert.match(captioned, /class="sk-caption"/);
    assert.ok(texts(captioned).some(t => t.includes('Test fixture')));
    assert.ok(texts(captioned).some(t => /illustrative/i.test(t)));
    assert.doesNotMatch(captioned, /class="sk-title"/);

    assert.match(both, /class="sk-title"/);
    assert.match(both, /class="sk-caption"/);

    const vb = (svg) => {
        const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
        return { w: +m[1], h: +m[2] };
    };
    const b0 = vb(bare), bt = vb(titled), bc = vb(captioned), bb = vb(both);
    assert.ok(bt.h > b0.h, `title should add height (${b0.h} -> ${bt.h})`);
    assert.ok(bc.h > b0.h, `caption should add height (${b0.h} -> ${bc.h})`);
    assert.ok(bb.h > bt.h && bb.h > bc.h, 'title+caption taller than either alone');
    // Title/caption slots are reserved only when given: the extra height is the slot, not a 16:9 pad.
    assert.ok(bt.h - b0.h <= 48, `title slot should be compact, got +${bt.h - b0.h}`);
    assert.ok(bc.h - b0.h <= 48, `caption slot should be compact, got +${bc.h - b0.h}`);
});

function ribbonFill(svg, source, target) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<path d="[^"]*" fill="([^"]+)"[^>]*class="sk-ribbon" data-source="${esc(source)}" data-target="${esc(target)}"`);
    const m = svg.match(re);
    assert.ok(m, `missing ribbon ${source} → ${target}`);
    return m[1].toUpperCase();
}

test('pro: house palette colours are used; auto ribbons follow target at the last column and skip ink/slate', () => {
    const svg = renderToString(HOUSEHOLD, [...PRO, '--background']);
    assert.match(svg, /#FF6601/i, 'tangerine highlight (themeIndex 0, Salary)');
    assert.match(svg, /#1F78B4/i, 'blue (themeIndex 1, Side income)');
    assert.match(svg, /#1F2933/i, 'ink still used on the Household income node');
    assert.doesNotMatch(svg, /sk-ribbon-grad-/);
    // Left-hand inflows are source-coloured; pooling outflows (into the last column) use the destination.
    assert.equal(ribbonFill(svg, 'Salary', 'Household income'), '#FF6601');
    assert.equal(ribbonFill(svg, 'Side income', 'Household income'), '#1F78B4');
    assert.equal(ribbonFill(svg, 'Household income', 'Savings'), '#2A7A6B');
    // Groceries is themeIndex 6, tint2 of grey-blue.
    assert.equal(ribbonFill(svg, 'Household income', 'Groceries'), '#BBC6D1');
    // Rent and Taxes are slate / slate-shade — too dark, so the ribbon falls back to light neutral.
    assert.equal(ribbonFill(svg, 'Household income', 'Rent'), '#A7B1BC');
    assert.equal(ribbonFill(svg, 'Household income', 'Taxes'), '#A7B1BC');
    // Ink must not be used as a ribbon fill (it may still colour the node bar).
    const ribbonFills = [...svg.matchAll(/<path d="[^"]*" fill="([^"]+)"[^>]*class="sk-ribbon"/g)].map(m => m[1].toUpperCase());
    assert.ok(ribbonFills.every(f => f !== '#1F2933' && f !== '#44546A'), `dark ribbon fill: ${ribbonFills}`);
    // Canvas token for pro+background is the cool off-white, not the default warm cream.
    assert.match(svg, /<rect class="sk-canvas-bg"[^>]*fill="#F7F8FA"/);
    // Default branded + standard still uses a cross-hue gradient and the default palette.
    const stock = renderToString(HOUSEHOLD);
    assert.match(stock, /sk-ribbon-grad-/);
    assert.doesNotMatch(stock, /#FF6601/i);
});

test('pro: --ribbon source|target|auto is deterministic, and auto is the default', () => {
    // Household: the pool node is ink, so source/target/auto all avoid it and agree.
    const autoImplicit = renderToString(HOUSEHOLD, PRO);
    const autoExplicit = renderToString(HOUSEHOLD, [...PRO, '--ribbon', 'auto']);
    assert.equal(autoImplicit, autoExplicit);
    assert.equal(autoImplicit, renderToString(HOUSEHOLD, [...PRO, '--ribbon', 'source']));
    assert.equal(ribbonFill(autoImplicit, 'Household income', 'Savings'), '#2A7A6B');
    assert.equal(ribbonFill(autoImplicit, 'Salary', 'Household income'), '#FF6601');

    // Pension last-column inflows distinguish the modes: auto/target use the destination,
    // source uses Annuity's plum / Drawdown's grey-blue.
    const pAuto = renderToString(PENSION, PRO);
    const pSource = renderToString(PENSION, [...PRO, '--ribbon', 'source']);
    const pTarget = renderToString(PENSION, [...PRO, '--ribbon', 'target']);
    assert.equal(pAuto, renderToString(PENSION, [...PRO, '--ribbon', 'auto']));
    assert.notEqual(pSource, pAuto);
    assert.equal(ribbonFill(pAuto, 'Annuity', 'Retirement income'), '#FF6601');
    assert.equal(ribbonFill(pTarget, 'Annuity', 'Retirement income'), '#FF6601');
    assert.equal(ribbonFill(pSource, 'Annuity', 'Retirement income'), '#6B4C8A');
    assert.equal(ribbonFill(pSource, 'Drawdown', 'Retirement income'), '#8DA0B3');
});

test('pro: middle-column labels sit in a canvas-coloured pill; Fees does not collide', () => {
    const household = renderToString(HOUSEHOLD, [...PRO, '--title', 'Household budget',
        '--caption', 'Test fixture. Illustrative, not a forecast.']);
    const pension = renderToString(PENSION, [...PRO, '--title', 'Pension flow',
        '--caption', 'Test fixture. Illustrative, not a forecast.']);
    for (const [svg, name] of [[household, 'household'], [pension, 'pension']]) {
        assert.match(svg, /class="sk-label-pill"/, `${name} should have mid-label pills`);
        // Pills use the canvas token (resolved on export when --background, or left as var).
        assert.match(svg, /class="sk-label-pill"[^>]*fill="(#F7F8FA|var\(--sk-canvas\))"/);
    }
    // Edge labels (Salary, Retirement income) must not be wrapped in a pill.
    const noPill = (svg, node) => {
        const g = svg.match(new RegExp(`<g class="sk-label" data-name="${node}"[\\s\\S]*?</g>`));
        assert.ok(g, `missing label group ${node}`);
        assert.doesNotMatch(g[0], /sk-label-pill/, `${node} is an edge label and should not have a pill`);
    };
    noPill(household, 'Salary');
    noPill(pension, 'Retirement income');

    // Fees "admin" and Drawdown pills must not overlap vertically.
    const pills = [...pension.matchAll(/<rect class="sk-label-pill" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)]
        .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
    assert.ok(pills.length >= 3, `expected several mid-column pills, got ${pills.length}`);
    for (let i = 0; i < pills.length; i++) {
        for (let j = i + 1; j < pills.length; j++) {
            const a = pills[i], b = pills[j];
            const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            assert.ok(ox <= 0 || oy <= 0, `pills overlap: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        }
    }
});

test('pro: typography stack, value hierarchy, and number formatting are preserved', () => {
    const svg = renderToString(HOUSEHOLD, PRO);
    assert.match(svg, /Segoe UI.*Selawik.*Helvetica.*Arial/);
    assert.match(svg, /class="sk-label-name"/);
    assert.match(svg, /class="sk-label-value"/);
    // Values keep thousands separators (en-US) and the same rounding rules as the engine.
    assert.ok(titles(svg).includes('Household income: 3,650'));
    assert.ok(titles(svg).includes('Household income → Rent: 1,400'));
    const pension = renderToString(PENSION, PRO);
    assert.ok(titles(pension).includes('Pot@2 → Fees "admin": 0.4'));
    assert.ok(titles(pension).includes('Retirement income: 15,000'));
});

test('pro: labels stay inside the canvas and do not overlap in the same column', () => {
    const measure = SankeyRender.createSelawikMeasurer();
    for (const [file, extra] of [
        [HOUSEHOLD, [...PRO, '--title', 'Household budget', '--caption', 'Test fixture. Illustrative, not a forecast.']],
        [PENSION, [...PRO, '--title', 'Pension flow', '--caption', 'Test fixture. Illustrative, not a forecast.']],
    ]) {
        const svg = renderToString(file, extra);
        const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
        const W = +vb[1], H = +vb[2];
        const re = /<text x="([^"]+)" y="([^"]+)"(?: text-anchor="([^"]+)")? class="([^"]+)" font-size="([^"]+)">([^<]*)<\/text>/g;
        const boxes = [];
        for (const m of svg.matchAll(re)) {
            const x = +m[1], y = +m[2], anchor = m[3] || 'start', cls = m[4], size = +m[5], text = decode(m[6]);
            const weight = cls === 'sk-label-name' || cls === 'sk-title' || cls === 'sk-col-label' ? 600 : 400;
            const w = measure(text, `${weight} ${size}px "Segoe UI", Selawik, Helvetica, Arial, sans-serif`);
            const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
            const right = left + w;
            const top = y - size * 0.85;
            const bot = y + size * 0.25;
            const slop = 1.5;
            assert.ok(left >= -slop, `${file} "${text}" clips left (${left})`);
            assert.ok(right <= W + slop, `${file} "${text}" clips right (${right} > ${W})`);
            assert.ok(top >= -slop, `${file} "${text}" clips top (${top})`);
            assert.ok(bot <= H + slop, `${file} "${text}" clips bottom (${bot} > ${H})`);
            boxes.push({ text, cls, left, right, top, bot, x });
        }
        assert.ok(boxes.length > 4, 'expected labels');
        // Same-column node labels (similar x, name or value): no vertical overlap.
        const nodeLabels = boxes.filter(b => b.cls === 'sk-label-name' || b.cls === 'sk-label-value');
        for (let i = 0; i < nodeLabels.length; i++) {
            for (let j = i + 1; j < nodeLabels.length; j++) {
                const a = nodeLabels[i], b = nodeLabels[j];
                if (Math.abs(a.x - b.x) > 8) continue; // different column / side
                const overlap = Math.min(a.bot, b.bot) - Math.max(a.top, b.top);
                // Name+value of the same label stack share an x and sit one after the other;
                // allow a 1px touch but not a real overlap.
                assert.ok(overlap <= 1.0, `overlap ${overlap.toFixed(2)}px: "${a.text}" vs "${b.text}" in ${file}`);
            }
        }
    }
});

test('pro: --help lists the new flags; unknown existing-style values are still rejected', () => {
    const help = runCli(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--style standard\|classic\|modern\|pro/);
    assert.match(help.stdout, /--palette branded\|restrained\|house/);
    assert.match(help.stdout, /--title/);
    assert.match(help.stdout, /--caption/);
    assert.match(help.stdout, /--ribbon source\|target\|auto/);
    const badStyle = runCli([TEMPLATE, '/tmp/sankey-pro-bad.svg', '--style', 'neon']);
    assert.equal(badStyle.status, 2);
    const badPal = runCli([TEMPLATE, '/tmp/sankey-pro-bad.svg', '--palette', 'neon']);
    assert.equal(badPal.status, 2);
    const badRibbon = runCli([TEMPLATE, '/tmp/sankey-pro-bad.svg', '--ribbon', 'auto']);
    assert.equal(badRibbon.status, 2);
    assert.match(badRibbon.stderr, /only valid with --style pro/);
});

test('pro: default style output is unchanged when pro flags are not used (template viewBox)', () => {
    // Sanity that the default path still produces the hand-checked geometry.
    const svg = renderToString(TEMPLATE);
    assert.match(svg, /viewBox="0 0 900 506"/);
    assert.doesNotMatch(svg, /class="sk-title"/);
    assert.doesNotMatch(svg, /Selawik/);
});
