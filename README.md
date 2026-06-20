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

**SVG `<filter>` and `<linearGradient>` defs (used by the Classic/Modern
ribbon styles) survive export automatically** — they're inserted as normal
child elements of the live `<svg>` root, so `cloneNode(true)` carries them
over along with their `id`s, and every `filter="url(#...)"` reference on a
cloned path still resolves correctly. Verified by exporting with each
ribbon style active and rendering the resulting file standalone. This is
different from the `var(--sk-*)` case above specifically because filters
don't depend on the page's `:root` CSS at all — they're self-contained SVG
elements, not CSS custom properties.

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

## Ribbon style toggle (Standard / Classic / Modern)

Alongside the palette toggle, ribbons can be rendered in three finishes,
switchable live via buttons in the canvas card header and persisted to
`localStorage` (`ribbonStyle` in the saved state). All three use the exact
same geometry and color resolution — the style only changes how the fill
itself is finished, never what the diagram says or which colors mean what.

- **Standard** (default): flat solid fill, no filter. This is the baseline
  and should stay the safest, most universally-legible option.
- **Modern (glass):** a `feDropShadow` filter (`#sk-glass-shadow`) for a
  gentle lift off the canvas, plus a separate white linear-gradient overlay
  path (`#sk-glass-sheen`, same `d` attribute as its parent ribbon so it's
  perfectly clipped to the same shape) suggesting a soft highlight along
  the top edge. The sheen is a second `<path>` element layered on top of
  the ribbon, not baked into the ribbon's own fill — see *Hover/dim sync*
  below for why that matters.
- **Classic (brushed):** an SVG filter (`#sk-brush-filter`) combining (1) a
  low-amplitude `feDisplacementMap` for organic edge softness and (2) a
  **directional** `feTurbulence` layer (markedly different `baseFrequency`
  on the x vs y axis) composited at low alpha via `feColorMatrix` +
  `feComposite` + `feMerge`, clipped to the ribbon's own alpha via
  `SourceAlpha`. The directionality (streaks running along the ribbon's own
  horizontal flow axis, not generic noise) is what makes this read as an
  actual brush stroke rather than static/grain — an isotropic version was
  tried first and looked like noise, not a brush.

### Getting the brush filter right took several real iterations

Worth recording because the wrong-looking versions are exactly the kind of
thing that's easy to reintroduce by "fixing" this code without re-rendering
it. Three failed attempts before landing on the current parameters, each
confirmed by actually rendering and screenshotting (not just code review):

1. High-frequency, high-amplitude displacement
   (`baseFrequency="0.9 0.045"`, `scale="3.2"`) — produced a jagged sawtooth
   edge that read as a rendering bug, not a texture. Rejected.
2. Low-frequency edge softness plus a separate fine-grain overlay at very
   low alpha — correct concept, but invisible at the thickness real
   ribbons actually render at on a typical viewport (the test swatches used
   during development were much fatter than real ribbons, which hid the
   problem). Rejected as ineffective, not wrong in principle.
3. A "highlight streaks" variant using a `feColorMatrix` with a **negative**
   alpha coefficient — introduced visible color fringing (the negative
   coefficient pushes some channels below zero in ways that don't clip
   cleanly). This was a real bug, not a style judgment call. Rejected.

The version now in the file (`baseFrequency="0.012 0.35"` for the streak
layer, alpha coefficient `0.32`, edge displacement `scale="3.5"` on a
`"0.02 0.05"` base) was verified at both a large test-swatch size and at
realistic thin mobile-ribbon thickness before being integrated. **If you
change these numbers, re-verify at realistic ribbon thickness specifically**
— a texture that looks great on a fat 200px-tall test swatch can be
completely invisible on a real ~15px ribbon, which is exactly what
happened in iteration 2 above.

### Hover/dim sync for the glass sheen overlay

The Modern style's sheen is a second `<path>` layered over its parent
ribbon, sharing the same `class="sk-ribbon"` and the same
`data-source`/`data-target` attributes so it dims in sync during hover
highlighting (see `attachLinkHighlighting()`). It has `pointer-events:none`
so it never intercepts the hover/click that should land on the ribbon
underneath it. **If you add another overlay-style effect, follow this same
pattern** (shared data attributes, `pointer-events:none`, same path `d`),
and check `attachLinkHighlighting()`'s ribbon-hover handler specifically —
it was changed from identity comparison (`other !== r`) to a same-
source/target match (`isSameFlow`) precisely to handle a second element
sharing one flow's data correctly; reverting to identity comparison will
make any future overlay element get treated as an unrelated ribbon and
dim incorrectly when its own parent is hovered.

## App chrome (everything outside the diagram itself)

The editor UI — toolbar, node list, flow table, panel headers — deliberately
shares the diagram's own design language rather than looking like a generic
admin dashboard wrapped around a nice chart. **This was a real product
decision made explicit in this session**: the diagram itself (ribbons,
nodes, labels, headline) is governed entirely by `generateDiagram()` and the
research-backed tokens described above and was NOT touched in this pass —
only the surrounding editor chrome changed.

### Shared visual language

A handful of CSS classes (defined near the top of the `<style>` block,
above the `:root` diagram tokens) are used everywhere outside the SVG:

- `.panel` / `.panel-header` / `.panel-title` / `.panel-subtitle` — every
  card (Nodes, Flows, Diagram) uses these, so they read as one family
  rather than three differently-styled boxes.
- `.btn` with a modifier (`.btn-ghost`, `.btn-primary`, `.btn-danger-ghost`)
  — one button shape and sizing throughout; only the modifier changes
  weight/color for primary vs. secondary vs. destructive actions.
- `.btn-icon` — square icon-only buttons (add node, delete row).
- `.field-input` / `.field-select` — one input/select treatment, replacing
  several slightly different border/focus/padding combinations that existed
  per-panel before.
- `.pill-toggle-group` / `.pill-toggle-btn` — the segmented-control pattern
  used for both the Restrained/Branded and Standard/Classic/Modern toggles;
  previously each toggle group had near-duplicate but not-quite-identical
  inline styling.
- `.editor-row` — the hover/layout treatment for each node row, with
  `.row-delete` opacity-on-hover so the delete button doesn't visually
  compete with the row's content at rest.

The app background, card backgrounds, borders, and ink color are drawn from
the same warm palette family as the diagram's own `--sk-canvas`/`--sk-ink`
tokens (though defined as separate literal hex values in the chrome classes
rather than reusing the `--sk-*` custom properties directly, since those are
scoped conceptually to the diagram and exporting the diagram should never
accidentally pull in app-chrome-only colors).

### Toolbar

Reduced from three visually-boxed button clusters plus a free-floating
Clear button down to one continuous row, grouped by task with quiet
dividers: file data (Import / Export data), color branding (Load colors /
Save colors), then destructive/primary actions (Clear, Export SVG). The
**Render Layout button was removed** — it was a leftover from an earlier
architecture; every data mutation path (`addNode`, `updateNodeName`,
`updateNodeColor`, `deleteNode`, `addFlowRow`, `updateLink`, `deleteLink`,
both JSON import handlers) already calls `generateDiagram()` directly, so
the diagram has been auto-updating on every edit for several sessions —
the button just hadn't been cleaned up. If you ever find yourself wanting
to re-add a manual "render" step, that almost certainly means an edit path
was added that forgot to call `generateDiagram()` — fix that path instead.

### Color picker

Replaced the raw native `<input type="color">` (which opens the browser's
own unconstrained color wheel) with a custom popover (`openColorPicker()` /
`buildColorPopover()`) following the Microsoft Office picker pattern: a
fixed set of core hues (`SWATCH_CORE_HUES`) shown as a base row, with
lighter tints above and darker shades below (`SWATCH_TINTS` / `SWATCH_SHADES`,
mixed via `mixToward()`/`shadeHue()`), all in one grid. This keeps branding
choices visually consistent rather than letting colors drift across
arbitrary RGB values when a few different people edit the same file over
time. A custom hex input remains underneath the grid for genuine one-off
brand colors that don't appear in the core set.

The popover is triggered from a `.swatch-trigger` button on each node row
(`openColorPickerFor`), positioned via `getBoundingClientRect()` near its
trigger, and closes on outside click (`handleColorPickerOutsideClick`,
attached via a capturing `mousedown` listener with a `setTimeout(...,0)`
guard so the same click that opened it doesn't immediately close it). Only
one popover can be open at a time (`activeColorPicker` module-level
reference); opening a new one closes any previous one first.

**If you add another place that needs color selection**, reuse
`openColorPicker(triggerEl, currentColor, onSelect)` rather than building a
second picker — it's deliberately generic (not hardcoded to node rows) for
exactly this reason.

### Node rows: inline editing instead of `prompt()`

`addNode()` previously used a native `prompt()` dialog to ask for a name.
This was replaced with immediate inline creation (a sensible default name
like "Node 4") followed by auto-focusing and auto-selecting that row's text
input, so the person can just start typing a real name with no dialog in
the way. If you change `addNode()`, preserve the auto-focus — it's the
difference between this feeling instant and feeling like a form.

### Middle-column value chip legibility fix

The small value label drawn directly on middle-column nodes (e.g. "237.6"
on the Direct/Indirect Channel nodes in the bundled example) previously
used white text with a dark stroke halo (`paint-order: stroke`) sitting
directly on the node's fill color. This was confirmed hard to read — the
halo visually fights the fill text at the small size these chips render
at. Replaced with a small white pill (`rx="3.5"`, sized by actually
measuring the value text width so it's never cramped) containing dark
`var(--sk-ink)` text, which stays legible on every node color including
the saturated profit/cost accents. This is a presentation-layer change
inside `generateDiagram()` (the one part of the rendering engine touched
this session) — the underlying node-value calculation and layout were not
changed, only how that one piece of text is drawn.

## Theme palette architecture

Node colors are NOT literal hex strings. `node.color` is a reference object
`{themeIndex, variant}` pointing into a global `themePalette` array (8 base
hex colors). The actual color is derived live by `resolveThemeColor(ref)`
every time it's needed — never cached on the node itself. This mirrors how
Word/Excel's "Theme Colors" work: a document doesn't remember "blue", it
remembers "Accent 3, 25% Lighter", so changing the theme's Accent 3 later
updates every place that used it. Concretely here: editing `themePalette[3]`
via the gradient/RGB picker immediately re-colors every node whose
`color.themeIndex === 3`, at whatever tint/shade variant each one
individually had chosen.

### Why this shape, specifically

This was a deliberate design decision (not an accident of incremental
development): theme colors are app-level/system state (a default baked
into `index.html`, optionally overridden by loading a theme JSON), while
node-to-color assignment is per-diagram data (lives in the nodes array,
travels with the data JSON). Keeping these separate means a person can
swap in a different corporate theme and have it flow through automatically
to every diagram built against it, without needing to re-pick every node's
color by hand — and conversely, a single diagram's node-to-theme-slot
assignments stay stable even as the theme's actual hues evolve.

### Variant naming and the exact percentages

`variant` is one of: `'base'`, `'tint0'` through `'tint4'` (lighter, tint0
= 10% lighter up to tint4 = 80% lighter), or `'shade0'`/`'shade1'` (darker,
shade0 = 25% darker, shade1 = 50% darker). These are the exact Microsoft
Office theme-color picker percentages (`THEME_TINT_PERCENTS` /
`THEME_SHADE_PERCENTS` constants), not arbitrary mix amounts — matched
against a reference screenshot of Office's own picker rather than guessed,
specifically because a prior version of this tool used made-up percentages
that didn't visually match the light/dark differentiation the person
expected from an Office-style picker. `deriveVariant(baseHex, variant)`
does the actual mixing via `mixToward()` (linear RGB interpolation toward
white for tints, toward black for shades).

### The picker UI: two views in one popover

`buildColorPopover()` renders the default grid view: 8 theme-color columns
× 8 rows (5 tints, base, 2 shades), exactly mirroring the Office layout.
Hovering any BASE-row swatch reveals a small pencil affordance
(`.color-swatch-edit-affordance`); clicking it swaps the popover's content
for `buildThemeColorEditor()`, a real gradient saturation/value square plus
hue strip plus synchronized R/G/B and hex number inputs (HSV math via
`hsvToRgb()`/`rgbToHsv()`). Dragging the gradient updates the RGB/hex
fields; typing into the RGB/hex fields moves the gradient cursor — both
directions read/write the same shared `{h, s, v}` closure variables, which
is what keeps them in sync. Every edit immediately writes to
`themePalette[themeIndex]`, calls `generateDiagram()` and `renderNodes()`
to re-render live, and saves to localStorage — there's no separate "Apply"
step. A back chevron returns to the grid view. Both the gradient square and
hue strip support touch as well as mouse dragging (`touchstart` /
`touchmove` / `touchend` alongside the `mousedown`/`mousemove`/`mouseup`
handlers, normalized through a shared `eventPoint()` helper) — this was a
deliberate fix during development after confirming mouse-only handlers
don't reliably receive synthetic events on touchscreens.

### Breaking change: data file version 2

Because `node.color` changed shape entirely (literal hex string →
`{themeIndex, variant}` reference object), old data JSON files are
genuinely incompatible, not just stylistically different. This was a
deliberate decision, not an oversight: `exportJSON()`/the import handler
now read/write `version: 2`, and importing a file that isn't exactly
`version === 2` (or whose node colors aren't shaped like reference objects)
is rejected outright with a specific, actionable error message rather than
silently misinterpreted or auto-migrated. The bundled sample files
(`sankey_data_*.json`) were regenerated to the new schema as part of this
change. The old "branding profile" JSON concept (a separate file mapping
node names to literal hex colors) was retired entirely and replaced by a
much smaller **theme JSON** (`exportTheme()`/`importTheme()`,
`{themeVersion, themePalette}` — just the 8 base colors, nothing about
nodes at all), reflecting the new separation between theme (system/app
level) and node-to-slot assignment (per-diagram data).

## Responsive layout and live resize/rotation

The editor grid (Nodes / Flows / Diagram) uses a custom three-tier CSS
grid (`.sankey-layout-grid` and its `.sankey-col-*` children), not
Tailwind's `lg:` utility classes. This was a deliberate fix: Tailwind's
`lg:` breakpoint is 1024px, which never activates on a phone screen even
in landscape (a phone in landscape is typically ~650-950px wide) — without
an intermediate tier, rotating a phone produced a taller scroll of the
exact same narrow single-column layout, confirmed by rendering before the
fix and seeing zero layout change between portrait and landscape. The
three tiers: default/narrow stacks everything in one column; 700px+ pairs
Nodes+Flows into a left column and gives Diagram a genuinely wide right
column (this is the tier that makes landscape actually worth rotating to);
1024px+ is the original three-way split.

A CSS layout change alone isn't sufficient, though — `generateDiagram()`
only measures its container and redraws when it's called, and previously
the only things that called it were data edits. Rotating the device
without touching any data wouldn't have redrawn the SVG at its new,
correct width until the next unrelated edit. Fixed with a `ResizeObserver`
(`initResizeObserver()`, wired up at the end of `window.onload`) watching
`#sankey-canvas-shell` directly, which calls `generateDiagram()` again
(debounced ~120ms via `scheduleResizeRedraw()`, since rotation fires
several intermediate resize events in quick succession) whenever the
container's real width changes by more than a pixel. The width-delta
check specifically guards against a feedback loop: `generateDiagram()`
itself replaces the shell's children, which can trigger a spurious
`ResizeObserver` callback even when the box itself didn't change size;
comparing against the last known width before scheduling a redraw avoids
redrawing in response to its own previous redraw. Verified by simulating
an actual rotation in a live page (resizing the same loaded page from a
portrait viewport to a landscape one, not reloading at a different
viewport) and confirming the SVG's `viewBox` width changed with zero other
interaction, in both directions (portrait→landscape and back), and that a
single normal data edit still triggers exactly one `generateDiagram()`
call (not two, which would indicate the observer was firing spuriously).

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
- **V3:** Full rebuild dropping Plotly entirely for hand-authored SVG, after
  a real screenshot showed labels still overlapping/clipping and the
  overall look reading as generic chart-library output rather than
  designed. Researched Bloomberg/McKinsey/FT/Economist/SankeyArt/SankeyMATIC
  technique specifically (see *Design system* above) and rebuilt the color,
  typography, and label-placement systems around those findings. Found and
  fixed the root cause of the label-collision bug (middle-column floating
  labels had no safe space) by changing the label architecture rather than
  tuning collision thresholds. Added the Restrained/Branded palette toggle
  to keep the tool usable for non-financial data while defaulting to the
  research-backed restrained look.
- **V4:** Fixed a real canvas-sizing bug reported via screenshot
  (diagram not filling the available card space, dead space below it). Root
  cause was NOT the obvious height-formula guess it first appeared to be —
  it was a genuine CSS flexbox issue: a child div with `height:100%` inside
  a `display:flex; align-items:center` parent does not resolve percentage
  height against that parent (only `align-items:stretch`, the default,
  does), so the chart container was collapsing to its content's intrinsic
  size before the SVG existed. Diagnosed with isolated minimal HTML test
  cases (not guessed from reading the CSS), confirmed with real Playwright
  measurements. Fixed by changing the `<svg>` itself to
  `width:100%; height:auto` so it always renders at its true content-driven
  aspect ratio, and by computing both `W` and `H` purely from the diagram's
  own content needs (measured label widths, node count) rather than trying
  to match a container size that created a chicken-and-egg measurement
  problem. This in turn surfaced a second real bug — the headline text,
  previously drawn at a fixed 16px, could overflow/clip on the narrower `W`
  values this fix produces on small viewports; fixed by measuring the
  headline and scaling its font size down (floored for legibility) to fit
  available width, the same "measure before drawing" approach already used
  for label margins. Also added the Standard/Classic/Modern ribbon style
  toggle (see above) at the same time, including several rendered-and-
  rejected iterations of the brush filter before landing on a version
  confirmed visible at realistic ribbon thickness.
- **V5:** Scope for this session was explicit: the diagram engine,
  color/style toggles, and data model were locked — "don't change the
  output or functionality around the Sankey diagram" — everything else was
  open for a genuine rethink. Removed the dead Render Layout button after
  confirming every data-mutation path already auto-renders. Replaced the
  native `<input type="color">` with a custom Office-style swatch-grid
  picker (see *Color picker* above) so branding stays consistent across a
  small set of core hues plus tints/shades instead of arbitrary RGB.
  Rewrote the middle-column value chip from white-text-with-stroke-halo to
  a white pill with dark ink text after confirming via rendered screenshot
  that the halo treatment was genuinely hard to read. Replaced `prompt()`-
  based node creation with inline auto-focused editing. Did a full visual
  pass unifying the app chrome (toolbar, panels, buttons, inputs, toggles)
  into one consistent design language drawn from the diagram's own
  ink/canvas palette, simplified UI copy throughout (dropped enterprise-
  software phrasing like "Render Layout" / "Configure a minimum of two
  nodes" / "Load Custom Corporate Color Profiles" in favor of plain
  language), and consolidated the canvas header's three separately-boxed
  control clusters into one coherent settings strip. Verified end-to-end
  via a real rendered test harness built from the actual extracted
  `<style>`/`<script>`/body markup (not retyped) including the color
  picker open/select/close flow, inline rename cascading to flow links,
  auto-focus on node creation, localStorage round-tripping, and layout at
  both mobile and desktop widths.
- **V6 (current):** Three changes, one of which (the width fix) took
  several real iterations to get right — each wrong version is recorded
  below because the failure modes are non-obvious and easy to
  reintroduce. (1) Removed the headline/subhead sentence above the
  diagram entirely, per direct request — the diagram now leads with the
  plot. Reclaimed the vertical space (`topPad` dropped from a
  headline-sized allowance to a flat 18px) and removed the now-fully-dead
  `.sk-headline`/`.sk-subhead`/`.sk-col-header` CSS (col-header had been
  unused dead code from even before this session). (2) Fixed a real "plot
  doesn't fill the width" bug, confirmed by direct measurement
  (`getBoundingClientRect()` on rendered node rects, not guessed): on a
  390px mobile viewport, `leftMargin`+`rightMargin` were together
  consuming ~70% of canvas width because they were sized to fit full
  12.5px label text regardless of how little width was actually
  available, leaving the ribbons a sliver. The fix went through three
  real attempts: first, capping the margin at a fraction of container
  width and shrinking the font to fit — this caused actual label
  clipping ("Wearables & Home" rendering as "rables & Home") because the
  cap was reapplied as a hard ceiling even when the floored font size
  still didn't fit. Second, removing that hard ceiling so the margin
  always grows to fit whatever the text needs — this stopped the
  internal clipping, but introduced a worse, sneakier bug: letting `W`
  (the SVG's internal coordinate width) grow past the real container
  width caused the entire diagram to be globally downscaled by the
  browser (the `<svg>` is `width:100%`), so a "floored" 9.5px label was
  actually rendering far smaller than 9.5px — it LOOKED clipped in a
  screenshot even though no boundary was cutting it off; the whole
  coordinate space had just been shrunk. This was caught by explicitly
  comparing the SVG's `viewBox` width against the real container's
  `getBoundingClientRect().width` — they must never diverge, since `W`
  exceeding the container is what triggers the downscale. Third and
  final: when even the floored font size doesn't fit the margin budget,
  wrap the label onto a second line (word-aware, breaks only at a space)
  rather than truncating it or growing `W` — explicitly chosen over
  ellipsis truncation because it preserves full meaning ("Gross Margin
  (Profit)" stays fully readable across two lines instead of becoming
  "Gross Ma…"). `MIN_LABEL_GAP` (the vertical collision-avoidance
  threshold between adjacent labels) widens automatically when any label
  in a column actually wraps, so two-line labels get enough room from
  their neighbors. **Also discovered and fixed during this work: SVG CSS
  class rules beat presentation attributes for font-size** — `.sk-label-
  name { font-size: 12.5px }` in the stylesheet was silently overriding a
  dynamically-computed `font-size="9.5"` attribute on the same element
  (confirmed via `getComputedStyle()` in an isolated test, not assumed);
  fixed by removing the hardcoded `font-size` from the CSS classes so the
  per-element attribute actually takes effect. (3) Reworked the color
  picker into a real theme-palette system — see *Theme palette
  architecture* above for the full design. In short: node colors became
  references into a shared 8-color `themePalette` rather than literal hex
  values, tint/shade percentages were corrected to match Office's actual
  picker (80/60/40/25/10% lighter, 25/50% darker — verified against a
  reference screenshot, not guessed), and each theme color gained a real
  gradient-square-plus-hue-strip-plus-RGB/hex editor with both input
  directions kept in sync. This was a deliberate breaking change to the
  data file format (bumped to `version: 2`); old files are rejected with
  a specific error rather than silently mis-loaded, and the bundled
  sample files were regenerated to match.
- **V7 (current):** Made rotating a phone to landscape a genuine way to
  get a wider diagram, not just a taller scroll of the same narrow
  layout — confirmed broken first (rendered at 844×390 and found zero
  layout difference from portrait) before fixing it, rather than assuming
  the existing `lg:` responsive classes already covered this. Two
  separate problems, both real: (1) the editor grid's only non-stacked
  breakpoint was Tailwind's `lg:` (1024px), which no phone reaches even
  in landscape — replaced with a custom three-tier CSS grid
  (`.sankey-layout-grid`) with an intermediate 700px+ tier that pairs
  Nodes+Flows into one column and gives Diagram a genuinely wide second
  column. (2) Even with the right CSS, nothing told the diagram to
  redraw when its container's size actually changed — `generateDiagram()`
  was only ever called from data-edit paths, so rotating the device
  without touching any data wouldn't have redrawn the SVG until the next
  unrelated edit. Fixed with a `ResizeObserver` on the canvas shell,
  debounced, with a width-delta guard to avoid the observer re-triggering
  itself off of `generateDiagram()`'s own DOM mutations. Verified by
  resizing one live, already-loaded page from a portrait viewport to a
  landscape one (not reloading at a different viewport, which wouldn't
  prove the live-resize path works) and confirming the rendered SVG's
  `viewBox` width changed with no other interaction, in both directions,
  plus confirming a single normal data edit still triggers exactly one
  `generateDiagram()` call so the new observer isn't causing redundant
  redraws.

## If you're picking this up fresh

Read, in order: *Why hand-authored SVG*, *Design system*, *Label placement
architecture*, *Ribbon style toggle*, *App chrome*, *Theme palette
architecture*, *Responsive layout and live resize/rotation*, then look at
`generateDiagram()` itself. Don't reach for a
charting library. Don't add a new CSS class without updating
`getStyledSvgString()`. Don't "fix" label collisions by making the check
more global without first understanding why it was deliberately scoped to
edge columns only. Don't trust a CSS sizing fix without actually rendering
and measuring it — the flexbox bug in V4 looked fixed after a plausible-
sounding code change and wasn't; it only got caught by building an
isolated test case and reading real `getBoundingClientRect()` output. The
same lesson repeated in V6's width fix: a fix that looks correct in the
SVG's own internal coordinate space can still be wrong once you account
for `width:100%` scaling against the real container — always compare
`viewBox` width against the actual rendered container width, not just
internal layout math. Keep the diagram engine and the app chrome
conceptually separate — V5 deliberately rewrote everything outside
`generateDiagram()` while leaving the function itself untouched except for
the one labeled exception (the value chip text treatment); V6 touched
`generateDiagram()` again, but only because the request (headline removal,
width fill) explicitly required it. Node colors are references into
`themePalette`, never literal hex — if you find yourself writing a literal
hex string onto `node.color`, that's very likely wrong; use
`resolveThemeColor()` to read, and a `{themeIndex, variant}` object to
write. When in doubt about a design choice, it's probably encoded in this
file already — search for it before re-deciding it.
