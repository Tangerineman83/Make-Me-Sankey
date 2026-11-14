# Changelog

## Unreleased — node.order, plot height, route colours, word gap (14 Nov 2026)

- Optional node field `order`: when every node in a column has a numeric order, the column is laid out top-to-bottom by that value (low = top). Partially ordered columns keep the default value-desc sort.
- `--plot-height <px>` (pro only, default 400) sets the plot's usable height.
- `--route-color Name:#HEX` (repeatable, opt-in) recolours each ribbon by its route end: the target if that name is listed, otherwise the source. Same rule as the job-local SVG post-process. Default output is unchanged without the flag.
- `--word-gap <em>` (opt-in) uses at least that spacing between words in labels, title and caption, and writes a matching SVG `word-spacing`. 0.40em is the recommended floor. Default output is unchanged.
- Tests sit in `test/layout-options.test.mjs`. AI-written by in-house executor.



## Unreleased — pro style preset and house palette (local branch, 14 Nov 2026)

- Opt-in `--style pro`: solid ribbons, crisp thin node bars, system-sans type, collision-avoided labels, content-fitted canvas height. Optional `--title` and `--caption` reserve space only when given.
- `--ribbon source|target|auto` (pro only, default auto): auto colours last-column inflows and pooling-node outflows by the destination, other links by the source. Ink and dark slate are not used as ribbon fills.
- Intermediate labels sit in a solid canvas-coloured pill, to the right of the node (or left if there is no room), with name and value on as few lines as fit.
- `--palette house`: colourblind-safe 8-slot studio palette with one tangerine highlight. Existing palettes and styles are unchanged.
- Tests for the new preset sit in `test/style-pro.test.mjs`. AI-written by in-house executor.


## Unreleased — headless SVG renderer (local build, 14 Nov 2026)

- Extracted the hand-authored renderer (`generateDiagram()` layout, ribbons, nodes, labels, pass-through collapse, colour helpers, export tokens) from `index.html` into `sankey-render.js` (UMD: browser global `SankeyRender`, or `require()` in Node). No visual rules changed.
- `index.html` loads `sankey-render.js` and `generateDiagram()` is now a thin wrapper that feeds page state to the shared engine; the page's Export SVG output is byte-identical to before (checked in headless Chrome across 15 render states).
- New CLI `scripts/render-sankey.mjs <input.json> <output.svg>` for version-2 data files, with deterministic output.
- Tests: `npm test` (`node --test`), covering the acceptance tests, a second fixture and an independent review fixture.
- AI-written by in-house executor (Claude Code not used: not signed in), reviewed by Modelling Expert.
