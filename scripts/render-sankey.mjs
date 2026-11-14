#!/usr/bin/env node
// render-sankey.mjs — render a version-2 Make Me Sankey JSON file to a standalone SVG,
// with the same engine the web app uses (sankey-render.js). No browser, no network.
//
//   node scripts/render-sankey.mjs <input.json> <output.svg|-> [options]
//
// AI-written by in-house executor, reviewed by Modelling Expert.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SankeyRender = require('../sankey-render.js');

const USAGE = `Usage: node scripts/render-sankey.mjs <input.json> <output.svg|-> [options]

Renders a version-2 Sankey JSON file (schema: data-template.json) to SVG, identical in
style to the web app's "Export SVG". Output is deterministic for the same input+options.

Options (defaults match the web app after it first opens):
  --palette branded|restrained|house  colour mode (default: branded = each node's theme colour;
                                  house = colourblind-safe studio palette, one tangerine highlight)
  --style standard|classic|modern|pro ribbon finish (default: standard; pro is an opt-in
                                  layout: solid ribbons, tight canvas, system sans)
  --aspect 16:9|4:3|portrait      diagram aspect ratio (default: 16:9; ignored for height in pro)
  --width <px>                    layout width before labels widen it (default: 900)
  --plot-height <px>              pro only: set the plot's usable height (default: 400)
  --route-color Name:#HEX         recolour ribbons by route end (target, else source);
                                  repeatable. Default output is unchanged without this flag
  --word-gap <em>                 minimum space between words in labels, title and caption
                                  (0.40 is the recommended floor). Off by default
  --opacity <0..1>                ribbon opacity (default: 0.45; 0.42 when --style pro)
  --names-only                    hide values on middle-column labels (edge columns keep them)
  --expand                        show pass-through nodes instead of collapsing them
  --background                    keep the canvas fill (default: transparent)
  --title <text>                  title above the plot (reserves space only when given; pro)
  --caption <text>                caption below the plot (reserves space only when given; pro)
  --ribbon source|target|auto     pro only: which end colours each ribbon (default: auto)
  -h, --help                      show this help`;

function fail(msg, code) { process.stderr.write(`render-sankey: ${msg}\n`); process.exit(code); }

function parseArgs(argv) {
    const opts = { paletteMode: 'branded', ribbonStyle: 'standard', diagramAspect: '16:9', width: 900,
        globalOpacityValue: 0.45, showValues: true, showPassThrough: false, background: false,
        title: undefined, caption: undefined, ribbonColorMode: undefined, plotHeight: undefined,
        routeColors: undefined, wordGapEm: undefined };
    const pos = [];
    let opacitySet = false;
    const choice = (name, v, allowed) => { if (!allowed.includes(v)) fail(`${name} must be one of ${allowed.join(', ')}`, 2); return v; };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => { if (i + 1 >= argv.length) fail(`${a} needs a value`, 2); return argv[++i]; };
        switch (a) {
            case '-h': case '--help': process.stdout.write(USAGE + '\n'); process.exit(0);
            case '--palette': opts.paletteMode = choice(a, next(), ['branded', 'restrained', 'house']); break;
            case '--style': opts.ribbonStyle = choice(a, next(), ['standard', 'classic', 'modern', 'pro']); break;
            case '--aspect': opts.diagramAspect = choice(a, next(), ['16:9', '4:3', 'portrait']); break;
            case '--width': { const w = Number(next()); if (!Number.isFinite(w) || w < 100 || w > 10000) fail('--width must be a number from 100 to 10000', 2); opts.width = w; break; }
            case '--plot-height': { const h = Number(next()); if (!Number.isFinite(h) || h < 100 || h > 10000) fail('--plot-height must be a number from 100 to 10000', 2); opts.plotHeight = h; break; }
            case '--route-color': {
                const v = next();
                const m = /^(.+):(#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}))$/.exec(v);
                if (!m || !m[1].trim()) fail('--route-color must be Name:#RGB or Name:#RRGGBB', 2);
                let hex = m[2].toUpperCase();
                if (hex.length === 4) hex = '#' + hex.slice(1).split('').map(c => c + c).join('');
                if (!opts.routeColors) opts.routeColors = {};
                opts.routeColors[m[1]] = hex;
                break;
            }
            case '--word-gap': {
                const g = Number(next());
                if (!Number.isFinite(g) || g <= 0 || g > 2) fail('--word-gap must be an em value above 0 and at most 2 (0.40 is the recommended minimum)', 2);
                opts.wordGapEm = g;
                break;
            }
            case '--opacity': { const o = Number(next()); if (!Number.isFinite(o) || o < 0 || o > 1) fail('--opacity must be from 0 to 1', 2); opts.globalOpacityValue = o; opacitySet = true; break; }
            case '--names-only': opts.showValues = false; break;
            case '--expand': opts.showPassThrough = true; break;
            case '--background': opts.background = true; break;
            case '--title': opts.title = next(); break;
            case '--caption': opts.caption = next(); break;
            case '--ribbon': opts.ribbonColorMode = choice(a, next(), ['source', 'target', 'auto']); break;
            default:
                if (a.startsWith('--')) fail(`unknown option ${a}\n\n${USAGE}`, 2);
                pos.push(a);
        }
    }
    if (pos.length !== 2) fail(`expected <input.json> and <output.svg>\n\n${USAGE}`, 2);
    if (opts.ribbonColorMode && opts.ribbonStyle !== 'pro') fail('--ribbon is only valid with --style pro', 2);
    if (opts.plotHeight && opts.ribbonStyle !== 'pro') fail('--plot-height is only valid with --style pro', 2);
    if (opts.ribbonStyle === 'pro' && !opacitySet) opts.globalOpacityValue = 0.42;
    if (opts.ribbonStyle === 'pro' && !opts.ribbonColorMode) opts.ribbonColorMode = 'auto';
    return { input: pos[0], output: pos[1], opts };
}

const { input, output, opts } = parseArgs(process.argv.slice(2));
let data;
try { data = JSON.parse(readFileSync(input, 'utf8')); }
catch (e) { fail(`could not read ${input}: ${e.message}`, 1); }
let svg;
try { svg = SankeyRender.renderStandaloneSvg(data, opts); }
catch (e) { fail(`${input}: ${e.message}`, 1); }
if (output === '-') process.stdout.write(svg);
else writeFileSync(output, svg);
