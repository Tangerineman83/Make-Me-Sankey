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
  --palette branded|restrained   colour mode (default: branded = each node's theme colour)
  --style standard|classic|modern ribbon finish (default: standard)
  --aspect 16:9|4:3|portrait      diagram aspect ratio (default: 16:9)
  --width <px>                    layout width before labels widen it (default: 900)
  --opacity <0..1>                ribbon opacity (default: 0.45)
  --names-only                    hide values on middle-column labels (edge columns keep them)
  --expand                        show pass-through nodes instead of collapsing them
  --background                    keep the warm canvas fill (default: transparent)
  -h, --help                      show this help`;

function fail(msg, code) { process.stderr.write(`render-sankey: ${msg}\n`); process.exit(code); }

function parseArgs(argv) {
    const opts = { paletteMode: 'branded', ribbonStyle: 'standard', diagramAspect: '16:9', width: 900,
        globalOpacityValue: 0.45, showValues: true, showPassThrough: false, background: false };
    const pos = [];
    const choice = (name, v, allowed) => { if (!allowed.includes(v)) fail(`${name} must be one of ${allowed.join(', ')}`, 2); return v; };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => { if (i + 1 >= argv.length) fail(`${a} needs a value`, 2); return argv[++i]; };
        switch (a) {
            case '-h': case '--help': process.stdout.write(USAGE + '\n'); process.exit(0);
            case '--palette': opts.paletteMode = choice(a, next(), ['branded', 'restrained']); break;
            case '--style': opts.ribbonStyle = choice(a, next(), ['standard', 'classic', 'modern']); break;
            case '--aspect': opts.diagramAspect = choice(a, next(), ['16:9', '4:3', 'portrait']); break;
            case '--width': { const w = Number(next()); if (!Number.isFinite(w) || w < 100 || w > 10000) fail('--width must be a number from 100 to 10000', 2); opts.width = w; break; }
            case '--opacity': { const o = Number(next()); if (!Number.isFinite(o) || o < 0 || o > 1) fail('--opacity must be from 0 to 1', 2); opts.globalOpacityValue = o; break; }
            case '--names-only': opts.showValues = false; break;
            case '--expand': opts.showPassThrough = true; break;
            case '--background': opts.background = true; break;
            default:
                if (a.startsWith('--')) fail(`unknown option ${a}\n\n${USAGE}`, 2);
                pos.push(a);
        }
    }
    if (pos.length !== 2) fail(`expected <input.json> and <output.svg>\n\n${USAGE}`, 2);
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
