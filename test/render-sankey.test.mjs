// Acceptance tests for make-me-sankey-cli v1 (spec section 5). Never edit to make pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO, runCli, renderToString, parseXml, texts, titles, tmp } from './helpers.mjs';

const TEMPLATE = path.join(REPO, 'data-template.json');
const HOUSEHOLD = path.join(REPO, 'test', 'fixtures', 'household-budget.json');

test('spec 1: CLI renders data-template.json to /tmp/sankey-template.svg and exits 0', () => {
    const r = runCli(['data-template.json', '/tmp/sankey-template.svg']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync('/tmp/sankey-template.svg'));
});

test('spec 2: output is well-formed XML with root <svg> and the template labels', () => {
    const svg = renderToString(TEMPLATE);
    const { root } = parseXml(svg);
    assert.equal(root, 'svg');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    const t = texts(svg);
    for (const label of ['Total', 'Category A', 'Category B', 'Outcome']) assert.ok(t.includes(label), `missing label ${label}`);
    for (const col of ['Start', 'Category', 'End']) assert.ok(t.includes(col), `missing column label ${col}`);
});

test('spec 3: two renders of the same JSON are byte-identical (and locale/TZ do not matter)', () => {
    const a = renderToString(TEMPLATE);
    const b = renderToString(TEMPLATE);
    assert.equal(a, b);
    const c = renderToString(TEMPLATE, [], { LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8', TZ: 'Asia/Tokyo' });
    assert.equal(a, c);
});

test('spec 4: link values 60 and 40 are reflected in the SVG', () => {
    const svg = renderToString(TEMPLATE);
    const tt = titles(svg);
    // Ribbon <title>s carry "source → target: value".
    for (const want of ['Total → Category A: 60', 'Total → Category B: 40', 'Category A → Outcome: 60', 'Category B → Outcome: 40'])
        assert.ok(tt.includes(want), `missing ribbon title ${want}`);
    // Node <title>s and the a11y <desc>.
    assert.ok(tt.includes('Total: 100'));
    assert.match(svg, /<desc id="sankey-a11y-summary">Sankey diagram flows\. Total to Category A: 60\. Total to Category B: 40\./);
    // Hand-checked geometry (900 px default width, 16:9): H = round(900*9/16) = 506; column labels
    // present so topPad = 42, bottomPad = 18, usable height = 446. "Total" is alone in column 0
    // with value 100, so it spans y 42 -> 488. Its two out-ribbons split that 60:40:
    //   60/100*446 = 267.6  -> Total→Category A leaves the node at y 42 .. 309.6
    //   40/100*446 = 178.4  -> Total→Category B leaves at y 309.6 .. 488
    // Column 1 has two nodes, gap = min(30, 420/2) = 30, available 416: A = 249.6 tall (42..291.6),
    // B = 166.4 tall (321.6..488). Ribbon A therefore arrives at 42..291.6.
    assert.match(svg, /viewBox="0 0 900 506"/);
    const total = /<rect x="53" y="42" width="12" height="446"[^>]*data-name="Total"/.test(svg);
    assert.ok(total, 'Total node geometry');
    // Path d = "M x0 sy0 C mid sy0, mid ty0, x1 ty0 L x1 ty1 C mid ty1, mid sy1, x0 sy1 Z".
    // Floats are compared to 1e-9 (JS prints 42 + 267.6 as 309.59999999999997).
    const ribbon = (target) => {
        const m = svg.match(new RegExp(`<path d="([^"]*)"[^>]*data-source="Total" data-target="${target}"`));
        assert.ok(m, `ribbon Total→${target}`);
        const n = m[1].match(/-?\d+(\.\d+)?/g).map(Number);
        return { sy0: n[1], ty0: n[7], ty1: n[9], sy1: n[15] };
    };
    const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
    const rA = ribbon('Category A'), rB = ribbon('Category B');
    near(rA.sy0, 42, 'A source top'); near(rA.sy1, 309.6, 'A source bottom');
    near(rA.ty0, 42, 'A target top'); near(rA.ty1, 291.6, 'A target bottom');
    near(rB.sy0, 309.6, 'B source top'); near(rB.sy1, 488, 'B source bottom');
    near(rB.ty0, 321.6, 'B target top'); near(rB.ty1, 488, 'B target bottom');
    // 60:40 split of the source edge: 267.6 / 178.4 = 1.5
    near((rA.sy1 - rA.sy0) / (rB.sy1 - rB.sy0), 1.5, 'ribbon thickness ratio 60:40');
});

test('spec 5: a second fixture (two sources fan in, four sinks fan out) renders and is identical on rerun', () => {
    const a = renderToString(HOUSEHOLD);
    const b = renderToString(HOUSEHOLD);
    assert.equal(a, b);
    assert.equal(parseXml(a).root, 'svg');
    const t = texts(a);
    for (const label of ['Salary', 'Side income', 'Household income', 'Rent', 'Groceries', 'Savings', 'Taxes']) assert.ok(t.includes(label), label);
    // Hand check: Household income = 3200 + 450 = 3,650 (thousands separator, en-US).
    assert.ok(titles(a).includes('Household income: 3,650'));
    assert.ok(titles(a).includes('Household income → Rent: 1,400'));
});

test('spec 6: index.html loads the shared renderer and generateDiagram delegates to it', () => {
    const html = readFileSync(path.join(REPO, 'index.html'), 'utf8');
    const tagAt = html.indexOf('<script src="sankey-render.js"></script>');
    assert.ok(tagAt > 0, 'script tag for sankey-render.js');
    const inlineAt = html.indexOf('<script>', tagAt);
    assert.ok(inlineAt > tagAt, 'shared renderer loads before the inline app script');
    assert.equal((html.match(/function generateDiagram\(\)/g) || []).length, 1);
    assert.match(html, /SankeyRender\.renderDiagramBody\(/);
    assert.match(html, /window\.applyImportedSankeyData = applyImportedSankeyData;/);
    // The engine is not duplicated in the page any more.
    assert.doesNotMatch(html, /function layoutColumn\(/);
    assert.doesNotMatch(html, /function computePassThroughGraph\(/);
    // The module itself loads as a browser global (UMD) and in Node.
    const src = readFileSync(path.join(REPO, 'sankey-render.js'), 'utf8');
    const fakeWindow = {};
    new Function('self', src)(fakeWindow);
    assert.equal(typeof fakeWindow.SankeyRender.renderDiagramBody, 'function');
});

test('CLI rejects version-1 data and bad options with clear errors', () => {
    const dir = tmp();
    const v1 = path.join(dir, 'v1.json');
    writeFileSync(v1, JSON.stringify({ version: 1, nodes: [{ name: 'A', color: '#000' }], links: [] }));
    const r1 = runCli([v1, path.join(dir, 'o.svg')]);
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /older, incompatible version/);
    const r2 = runCli(['data-template.json', path.join(dir, 'o.svg'), '--palette', 'neon']);
    assert.equal(r2.status, 2);
    const r3 = runCli(['data-template.json']);
    assert.equal(r3.status, 2);
});

test('CLI options change the output as documented', () => {
    const base = renderToString(TEMPLATE);
    const restrained = renderToString(TEMPLATE, ['--palette', 'restrained']);
    assert.notEqual(base, restrained);
    assert.doesNotMatch(restrained, /sk-ribbon-grad-/);           // no source→target gradients
    assert.match(base, /sk-ribbon-grad-0/);
    assert.match(renderToString(TEMPLATE, ['--aspect', '4:3']), /viewBox="0 0 900 675"/);
    assert.match(renderToString(TEMPLATE, ['--width', '1200']), /viewBox="0 0 1200 675"/);
    assert.match(renderToString(TEMPLATE, ['--background']), /<rect class="sk-canvas-bg"[^>]*fill="#f7f5f1"/);
    assert.doesNotMatch(base, /sk-canvas-bg/);
    assert.doesNotMatch(base, /var\(--/);                         // tokens resolved for standalone use
    const stdout = runCli(['data-template.json', '-']);
    assert.equal(stdout.status, 0);
    assert.equal(stdout.stdout, base);
});
