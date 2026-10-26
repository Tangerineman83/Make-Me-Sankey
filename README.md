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

## Efficiency notes

- Historical narrative trimmed from the live README for readability (core decisions remain encoded in code and comments).
- Single-file constraint preserved.
- Advanced editor remains available but secondary.

Open `index.html` to use. Export remains transparent SVG only.
