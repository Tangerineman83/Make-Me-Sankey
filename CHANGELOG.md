# Changelog

## Unreleased — headless SVG renderer (local build, 14 Nov 2026)

- Extracted the hand-authored renderer (`generateDiagram()` layout, ribbons, nodes, labels, pass-through collapse, colour helpers, export tokens) from `index.html` into `sankey-render.js` (UMD: browser global `SankeyRender`, or `require()` in Node). No visual rules changed.
- `index.html` loads `sankey-render.js` and `generateDiagram()` is now a thin wrapper that feeds page state to the shared engine; the page's Export SVG output is byte-identical to before (checked in headless Chrome across 15 render states).
- New CLI `scripts/render-sankey.mjs <input.json> <output.svg>` for version-2 data files, with deterministic output.
- Tests: `npm test` (`node --test`), covering the acceptance tests, a second fixture and an independent review fixture.
- AI-written by in-house executor (Claude Code not used: not signed in), reviewed by Modelling Expert.
