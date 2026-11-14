# Make Me Sankey

A standalone, single-file HTML tool for building presentation-quality Sankey diagrams from scratch — no build step, no server, no dependencies beyond CDN fonts/icons. Open `index.html` in a browser and it works.

**Primary input flow:** AI-assisted copy-paste. Describe your requirements, copy the generated prompt + data template, paste them into your favourite AI, then upload the completed JSON. The detailed node/flow editor is available for advanced users who want to tweak after the illustration is produced.

## Process flow

1. User describes requirements in the primary prompt box on the page.
2. The page generates a ready-to-copy context prompt + data template (JSON schema with examples and AI-friendly instructions).
3. User pastes the prompt and attaches/pastes the template into their favourite AI (Claude, Grok, ChatGPT, etc.).
4. AI populates the template.
5. User pastes or uploads the completed JSON; the diagram renders.
6. (Optional) Open the advanced editor to refine nodes, colors, flows, or styles.

This keeps full flexibility (arbitrary topology, colors, branding) while removing the coordination burden from the user for the common case.

## What this is

The tool has two halves: an editor and a hand-authored SVG renderer. The renderer computes every node, ribbon, and label directly (`generateDiagram()`). No charting library is used in the rendering path.

Full historical design notes, V1–V3 evolution, research, and constraints are preserved in prior commits and the code comments. The live README focuses on current use.

## Data model (AI-friendly)

```json
{
  "version": 1,
  "nodes": [
    { "name": "Source A", "color": "#1c1c1e" }
  ],
  "links": [
    { "source": "Source A", "target": "Target B", "value": 100 }
  ]
}
```

- Nodes can omit color (Restrained mode applies semantic green/red for profit/cost vocabulary, else neutral).
- Links must reference existing node names exactly.
- Optional: columnLabels, brandingProfile, etc. (see advanced editor).

The page supplies a pre-filled template and a detailed system-style prompt for the AI covering hue economy, label constraints, and the exact schema. See also `data-template.json`.

## Command-line renderer (headless SVG)

The renderer now lives in `sankey-render.js`, shared by the page and a Node CLI, so a data file can become an SVG without opening a browser:

```bash
node scripts/render-sankey.mjs data-template.json sankey.svg          # or "-" for stdout
node scripts/render-sankey.mjs my-data.json out.svg --palette restrained --aspect 4:3
npm test                                                              # node --test, no dependencies
```

- **Input:** the version-2 schema in `data-template.json`: `{ version: 2, nodes: [{ name, color: { themeIndex, variant } }], links: [{ source, target, value }], columnLabels: [string] }`. Optional node fields `displayName`, `value`, `column` work as in the page. Source/target must match node names exactly.
- **Output:** the same SVG as the page's "Export SVG" (transparent, colours resolved, styles inlined), byte-identical for the same input and options. Needs Node 18+; no npm packages, no network.
- **Options:** `--palette branded|restrained` (default branded), `--style standard|classic|modern`, `--aspect 16:9|4:3|portrait`, `--width <px>` (default 900), `--opacity <0..1>`, `--names-only`, `--expand`, `--background`. Run with `--help`.
- **Text widths:** the CLI measures labels with an embedded Inter width table (no kerning) instead of a browser canvas, so label-driven margins can differ from an on-screen render by a pixel or so.
- **Out of scope:** version-3 (series) files, PNG/PDF export, custom theme palettes, the AI copy-paste panel.

## Efficiency notes

- Historical narrative trimmed from the live README for readability (core decisions remain encoded in code and comments).
- Single-file constraint preserved.
- Advanced editor remains available but secondary.

Open `index.html` to use. Export remains transparent SVG only.

<!-- pages-trigger -->
