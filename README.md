# Make Me Sankey

A standalone, single-file HTML tool for building presentation-quality Sankey
diagrams from scratch — no build step, no server, no dependencies beyond CDN
fonts/icons. Open `index.html` in a browser and it works.

This README is the project baseline. Read it before making changes, and
update it when you make a design decision worth preserving — the goal is
that every future session (human or Claude) starts from informed context
instead of rediscovering decisions already made.

---

## What this is, in one paragraph

The tool has two halves: an editor (left/center — nodes, flows, import/export,
branding) and a renderer (right — the actual Sankey). The editor is plain
Tailwind + vanilla JS and is stable. The renderer is **hand-authored SVG**,
not a charting library — every node, ribbon, and label is computed and drawn
directly by `generateDiagram()` in the `<script>` block. There is no Plotly,
D3, or any other charting dependency in the rendering path.

## Why hand-authored SVG, not a charting library

The project went through three iterations before landing here:

1. **V1 (original prototype):** Plotly's native Sankey trace, with a
   `MutationObserver` hack injecting custom SVG gradients onto Plotly's
   internal DOM after each render. This fought the library constantly —
   labels clipped off-canvas, gradients used a fixed horizontal sweep
   regardless of each ribbon's actual curve, and `mix-blend-mode: multiply`
   muddied every brand color toward grey wherever ribbons crossed.
2. **V2:** Same Plotly base, patched harder — real per-link gradients
   computed from each path's bounding box, floating labels with leader
   lines, hover-to-isolate-path interactivity. Better, but still
   fundamentally constrained by what Plotly's Sankey trace allows, and
   still visually read as "exported from a charting library."
3. **V3 (current):** Full rebuild as hand-authored SVG, following the
   technique used by hand-built editorial finance Sankeys (see *Design
   research* below): manual cubic-bezier ribbon paths, a general-purpose
   topological column-assignment algorithm, two-pass proportional node
   sizing, and labels placed in dedicated margin space that's sized by
   actually measuring the longest label text before anything renders.

**If you're tempted to reach for a charting library again: don't, unless
the requirement changes substantially.** The hand-authored approach is more
code, but it's the only way to get ribbon curves, label placement, and color
treatment that read as deliberately designed rather than library-default.

## Design system (researched, not guessed)

The visual language is grounded in a researched comparison of how Bloomberg,
McKinsey, the Financial Times, The Economist, and the best open finance-Sankey
exemplars (SankeyArt, SankeyMATIC, USAFacts) actually build flow diagrams.
Full research notes live in the project's conversation history; the
actionable conclusions are encoded directly in the CSS custom properties at
the top of `index.html`:

```css
--sk-canvas: #f7f5f1;          /* warm off-white ground, not stark white */
--sk-neutral-ribbon: #aab1bd;  /* restrained-mode flow color */
--sk-neutral-node: #7c8694;    /* restrained-mode node color */
--sk-accent-profit: #1f8a5f;   /* gross margin / profit */
--sk-accent-cost: #c0533e;     /* cost / expense */
--sk-ink: #1c2127;
--sk-ink-muted: #767f8c;
```

### The core finding: hue economy

The single biggest lever on perceived quality is **how many distinct hues
are on screen at once**. Premium financial flow diagrams almost never color
every ribbon — they run the bulk of the diagram in neutral grey and reserve
one or two saturated "hero" accents (green for profit, red for cost) for
the flows that carry the actual story. A rainbow gradient per ribbon (the
literal default of Plotly/Plotapi/most chart libraries) is the single most
reliable tell that a diagram was machine-generated rather than designed.

### Two palette modes

Because this tool is general-purpose (not exclusively financial), the
restrained-by-default behavior is implemented as a **toggle**, not a
hardcoded rule:

- **Restrained mode (default):** ribbons render in `--sk-neutral-ribbon`,
  nodes in `--sk-neutral-node`, *except* any node whose name semantically
  matches profit/margin/income vocabulary (→ green) or cost/expense/loss
  vocabulary (→ red) — see `semanticRole()` and the `PROFIT_WORDS` /
  `COST_WORDS` regexes in the script. Ribbons inherit color from their
  **target** node, not a per-source rainbow.
- **Branded mode:** bypasses semantic detection entirely; every node and
  its outgoing ribbons use whatever explicit color is set on that node
  (the original per-category-color behavior). Use this for non-financial
  data where category identity matters more than a profit/cost narrative —
  e.g. a marketing funnel, an energy-flow diagram, anything where "grey
  unless it's profit or cost" doesn't make sense.

Toggle lives in the canvas card header (`Restrained` / `Branded` buttons),
persists to `localStorage`, and is read by `resolveNodeColor()` /
`resolveRibbonColor()` in the script.

### Other research-derived choices baked in

- **Flat fills, not gradients.** Ribbons are a single solid color at
  `fill-opacity` ≈ 0.45 at rest (the `Flow Fade` slider), lifted toward
  ~0.9 on hover. No source→target gradient sweep.
- **Tabular numerals.** All values use
  `font-variant-numeric: tabular-nums lining-nums` so figures align in
  columns rather than rendering with proportional digit widths.
- **Direct labeling, not a legend.** Every label sits adjacent to its node
  with a short leader line — see *Label placement architecture* below for
  why this is more constrained than it first looks.
- **Warm canvas ground** (`#f7f5f1`) for on-screen preview, matching the FT
  (`#fff1e5`) / Economist (`#f5f4f0`) convention of a "paper" tone instead
  of stark white — but see *Export is transparent* below, this is
  preview-only and is stripped from exported files.
- **The chart states a headline as a sentence** ("X is Y% of total
  throughput"), not just a topic label — McKinsey's "a chart is a sentence"
  doctrine. Falls back to a generic "Flow breakdown" headline when no node
  matches the profit-semantic vocabulary (i.e. for non-financial data).

## Label placement architecture (read this before touching labels)

This is the part of the codebase most likely to silently break, because the
failure mode (labels overlapping or clipping off-canvas) only shows up at
certain node counts / column counts / viewport widths, not in every test.

**The constraint that matters:** only the **leftmost and rightmost** columns
get full floating text labels (name + value, with a leader line). This is
deliberate, not an oversight. Those are the only two columns with dedicated
margin space reserved for them — `leftMargin` / `rightMargin` are computed
by actually measuring (`measureTextWidth()`, via an offscreen canvas
context) the widest label/value text in those two columns *before* layout
runs, so there's a structural guarantee the longest label always fits.

**Middle columns have no such guarantee** — there's no safe horizontal space
between two flow columns to put a floating text label without it either
overlapping the ribbons or reaching into the *next* column's label space.
This was the actual root cause of a real bug from an earlier iteration: a
middle-column label ("237.6") visually collided with a right-column label
("Cost of Sales / 214.1") on a narrow mobile viewport, because both were
being placed with floating text and not enough horizontal separation. The
fix was architectural, not a tuning knob: **middle-column nodes no longer
get floating text labels at all.** They get a small value-only chip drawn
directly on the node (visible only if the node is tall enough,
`nodeHeight >= 16`), and their full name is available via the native
`<title>` tooltip already attached to the node `<rect>`.

**If you need to change this:** the temptation will be to "just add more
margin" between columns so middle labels fit. Resist it unless you also
change the column-width calculation (`colX`) to reserve real measured space
for every column, not just the two edges — otherwise you'll reintroduce the
original bug on some dataset/viewport combination you didn't test.

**Collision logic within the edge columns** is a simple sequential check
(`wouldCollide = midY - lastShownMidY < MIN_LABEL_GAP`) — each node is
compared only to the *previous shown label in the same column*, which is
correct and sufficient because edge-column labels never compete with labels
from other columns (that's the whole point of the architecture above). Do
not "fix" this into a cross-column global check — that was tried, it works,
but it over-hides labels that don't actually need to be hidden (see
project history below if you want the failed-experiment details).

## Layout algorithm

`generateDiagram()` runs, in order:

1. **Column assignment** (`assignColumns`): nodes are ranked by longest
   path from any source node (a node with no inflow = rank 0; every other
   node's rank = max(predecessor ranks) + 1). This means the tool handles
   **arbitrary graph shapes**, not just a fixed N-column funnel — feed it
   a 2-column, 3-column, or 6-column flow and it lays out correctly without
   any hardcoded column count.
2. **Margin sizing**: measure the longest label/value text in the leftmost
   and rightmost columns, reserve that much horizontal space.
3. **Per-column node layout** (`layoutColumn`): two-pass proportional
   sizing — every node gets `value / total * available_height`, floored at
   a minimum (`MIN_NODE_H = 6`) so thin flows stay visible/hoverable; if
   that floor pushes the column's total past available height, every node
   in the column is scaled down by the same factor so the column never
   overflows. This technique is borrowed directly from a reference
   open-source Sankey implementation studied during the V3 rebuild.
4. **Ribbon routing**: links are processed in rank order, source nodes in
   display order, with running cursors per node so ribbons from/to the same
   node stack edge-to-edge with no gap and no overlap (`sourceCursors` /
   `targetCursors` maps). Ribbon paths are manual cubic beziers with control
   points at the horizontal midpoint between the two columns — this is what
   gives the flows a smooth "water" curve rather than a stiff
   library-default curve.
5. **Color resolution**: per the palette mode (see above).
6. **Labels**: per the architecture above.
7. **Headline/subhead**.

**Verified invariant, worth re-checking after any layout change:** at every
pass-through node, total inflow must equal total outflow (within floating
point tolerance). This was explicitly tested against the bundled Apple
product/channel/margin dataset during the V3 rebuild — see *Testing
approach* below.

## Export

**SVG only, transparent background, by design.** There is no PNG export.
This was an explicit decision (not a missing feature) to maximize onward
use — a transparent SVG drops cleanly into decks, docs, other designs, or
gets rasterized downstream at whatever resolution is needed, without this
tool needing to guess a target size/DPI.

The warm canvas background (`--sk-canvas`) is **preview-only**. It's
rendered as a tagged `<rect class="sk-canvas-bg">` that `getStyledSvgString()`
explicitly strips before export, so the exported file has no background fill
at all.

**If you add any new visual feature, check `getStyledSvgString()`:** it
clones the live SVG and must (a) resolve every `var(--sk-*)` custom
property reference to a literal hex value, since a standalone SVG file
opened outside this page has no access to the page's `:root` CSS, and
(b) inline equivalent versions of every CSS class the SVG depends on
(`.sk-leader`, `.sk-label-name`, etc.) into a `<style>` element inside the
SVG itself. **A new CSS class that isn't mirrored here will render
correctly on-screen but silently lose its styling in every exported file.**
This bit an earlier iteration (PNG export was completely broken — invisible
links, no labels — because the export path called back into the charting
library's own re-render instead of serializing what was actually on
screen); the current architecture avoids that class of bug by construction,
but only if `getStyledSvgString()` is kept in sync.

## File structure

Everything is one file: `index.html`. There is no build step. Sections,
top to bottom:

- `<style>`: design tokens (`:root` custom properties) + component classes.
- Editor markup: nodes panel, flow-mapping table, canvas card with the
  palette-mode toggle and Flow Fade slider.
- `<script>`, roughly in this order:
  - State (`nodes`, `links`, `globalOpacityValue`, `paletteMode`) +
    localStorage persistence (`sankeyWorkspaceData_v14` — bump this version
    string if you change the persisted shape, so old saved state doesn't
    get misread).
  - Editor functions (`renderNodes`, `renderFlowsTable`, `addNode`,
    `updateLink`, etc.) — stable, rarely need to change.
  - **Rendering engine** (`measureTextWidth` through
    `renderAccessibleSummary`) — this is where almost all future work will
    happen.
  - Import/export (JSON data, JSON branding profile, SVG).
  - `loadDefaultExample()` + `window.onload`.

## Data model

Two JSON shapes, both importable/exportable from the UI:

**Sankey data** (`sankey_data_*.json`):
```json
{
  "version": 1,
  "nodes": [{ "name": "iPhone", "color": "#1c1c1e" }],
  "links": [{ "source": "iPhone", "target": "Direct Channel", "value": 35.45 }]
}
```

**Branding profile** (`sankey_branding.json`) — a portable color palette,
matched onto nodes by name (case-insensitive) on import, independent of any
specific dataset:
```json
{ "brandingProfile": [{ "name": "iPhone", "color": "#1c1c1e" }] }
```

The bundled default example (`loadDefaultExample()`) is a simplified
Apple-style product → channel → margin/cost P&L flow, used throughout
development as the test dataset. It's a reasonable smoke test for the
"Restrained" palette mode specifically because it has unambiguous
profit/cost terminology (`Gross Margin (Profit)`, `Cost of Sales`).

## Known constraints / things not yet handled

- **Semantic word matching is English-only** and string-based
  (`PROFIT_WORDS` / `COST_WORDS` regexes in the script). A node named
  "Marge brute" (French for gross margin) will not be detected and will
  render neutral grey in Restrained mode. If multi-language support
  matters, this needs a configurable word list, not a code change per
  language.
- **No node dragging / manual repositioning.** Earlier Plotly-based
  iterations supported dragging nodes (with a "Reset Position" button);
  the hand-authored engine computes layout fresh on every render and does
  not support manual override. If this is a real requirement, it needs
  deliberate design (where does a dragged position persist? does it
  survive a data edit?), not a quick bolt-on.
- **No automatic ribbon-crossing minimization** beyond sorting nodes within
  a column by descending value. For graphs with many interleaved flows
  this can still produce more crossings than an optimal ordering would;
  true crossing minimization (e.g. a barycenter heuristic) hasn't been
  implemented.
- **Mobile viewport headroom is tight.** The tool is used inside a mobile
  chat app's in-browser preview at roughly 390px wide in practice. Margin
  sizing accounts for this (text is measured, not guessed), but very long
  node names on a narrow viewport will still consume a large fraction of
  total width. No current truncation/ellipsis fallback for extreme cases.

## Testing approach used during development

There is no automated test suite. Verification during the V3 rebuild was
done by extracting the rendering logic into standalone Node scripts and
running it against the real bundled dataset to check, explicitly:

- Column assignment produces the expected topological ranks.
- No `NaN` or negative-height nodes/ribbons.
- Inflow exactly equals outflow at every pass-through node.
- Ribbon stacking cursors fill each node's height exactly (no gap, no
  overflow) across all of that node's outgoing/incoming ribbons.
- Label collision logic produces zero same-column overlaps at a simulated
  narrow (390px) viewport width, using the real dataset's longest labels.

If you change the layout algorithm, re-verify at minimum the inflow/outflow
invariant and the no-overlap label guarantee — both are cheap to check by
copying the relevant function bodies into a throwaway Node script, and both
have been the source of real shipped bugs in earlier iterations.

## Change log (high-level)

- **V1:** Plotly + MutationObserver gradient injection hack. Shipped with
  multiple real bugs: labels clipping off-canvas, `mix-blend-mode: multiply`
  muddying brand colors, PNG/SVG export calling back into Plotly's bare
  re-render (so exports had invisible links and no labels at all — none of
  the on-screen styling carried over), a `localStorage` key mismatch that
  made "Clear" silently not clear anything.
- **V2:** Same Plotly base. Fixed the gradient direction (per-link bbox
  instead of fixed horizontal sweep), added floating labels with leader
  lines, fixed the broken export by serializing the live styled SVG instead
  of calling Plotly's re-render. Two A/B visual mockups (light/refined vs.
  dark/dramatic) were built to choose a direction; light was chosen.
- **V3 (current):** Full rebuild dropping Plotly entirely for hand-authored
  SVG, after a real screenshot showed labels still overlapping/clipping and
  the overall look reading as generic chart-library output rather than
  designed. Researched Bloomberg/McKinsey/FT/Economist/SankeyArt/SankeyMATIC
  technique specifically (see *Design system* above) and rebuilt the color,
  typography, and label-placement systems around those findings. Found and
  fixed the root cause of the label-collision bug (middle-column floating
  labels had no safe space) by changing the label architecture rather than
  tuning collision thresholds. Added the Restrained/Branded palette toggle
  to keep the tool usable for non-financial data while defaulting to the
  research-backed restrained look.

## If you're picking this up fresh

Read, in order: *Why hand-authored SVG*, *Design system*, *Label placement
architecture*, then look at `generateDiagram()` itself. Don't reach for a
charting library. Don't add a new CSS class without updating
`getStyledSvgString()`. Don't "fix" label collisions by making the check
more global without first understanding why it was deliberately scoped to
edge columns only. When in doubt about a design choice, it's probably
encoded in this file already — search for it before re-deciding it.
