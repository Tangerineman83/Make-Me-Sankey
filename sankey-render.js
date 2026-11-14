/*
 * sankey-render.js — the Make Me Sankey rendering engine, shared by index.html (browser)
 * and scripts/render-sankey.mjs (Node CLI).
 *
 * Extracted verbatim from index.html's generateDiagram() and its helpers. The visual
 * rules (layout, palette, ribbons, labels) are unchanged; only the page globals the
 * engine used to read (nodes, links, paletteMode, ...) are now passed in as `state`, and
 * the browser-only dependencies are passed in as `env`:
 *   env.measureTextWidth(text, font)  - canvas measureText in the page; an embedded
 *                                       Inter advance-width table in Node
 *   env.containerW                    - the on-screen container width (900 fallback)
 *   env.locale                        - number formatting locale (undefined in the page)
 *
 * No charting library, no DOM access, no network. Loads as a classic <script> (exposes
 * window.SankeyRender) or via require() in Node (UMD wrapper).
 *
 * AI-written by in-house executor, reviewed by Modelling Expert.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SankeyRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
        'use strict';

        // ---- Theme colour helpers (moved from index.html; behaviour unchanged) ----
        const DEFAULT_THEME_PALETTE = ['#1c2127', '#7c8694', '#c0533e', '#1f8a5f', '#2563eb', '#7c3aed', '#d97706', '#0891b2'];
        // House palette: colourblind-safe, one highlight (tangerine). 8 themeIndex slots.
        // 0 tangerine, 1 blue, 2 slate, 3 teal, 4 ink, 5 plum, 6 grey-blue, 7 neutral.
        const HOUSE_THEME_PALETTE = ['#FF6601', '#1F78B4', '#44546A', '#2A7A6B', '#1F2933', '#6B4C8A', '#8DA0B3', '#A7B1BC'];
        const THEME_TINT_PERCENTS = [0.80, 0.60, 0.40, 0.25, 0.10]; // "tint4".."tint0", lightest to least-light
        const THEME_SHADE_PERCENTS = [0.25, 0.50]; // "shade0".."shade1", least-dark to darkest

        function mixToward(hex, target, amount) {
            const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
            const mix = (c) => Math.round(c + (target - c) * amount).toString(16).padStart(2, '0');
            return '#' + mix(r) + mix(g) + mix(b);
        }

        // variant is 'base', 'tint0'..'tint4' (tint0 = 10% lighter ... tint4 = 80% lighter),
        // or 'shade0'..'shade1' (shade0 = 25% darker, shade1 = 50% darker).
        function deriveVariant(baseHex, variant) {
            if (!variant || variant === 'base') return baseHex;
            if (variant.startsWith('tint')) {
                const i = parseInt(variant.slice(4), 10);
                return mixToward(baseHex, 255, THEME_TINT_PERCENTS[4 - i]);
            }
            if (variant.startsWith('shade')) {
                const i = parseInt(variant.slice(5), 10);
                return mixToward(baseHex, 0, THEME_SHADE_PERCENTS[i]);
            }
            return baseHex;
        }

        // Resolves a node's color reference ({themeIndex, variant}) to an actual hex against
        // the given palette. Falls back to a neutral if the reference is missing or out of range.
        function resolveThemeColor(colorRef, themePalette) {
            if (!colorRef || typeof colorRef.themeIndex !== 'number') return '#7c8694';
            const base = (themePalette || DEFAULT_THEME_PALETTE)[colorRef.themeIndex];
            if (!base) return '#7c8694';
            return deriveVariant(base, colorRef.variant);
        }


        // Compute the pass-through collapsed version of nodes/links.
        // A node is a "pass-through" if: it has exactly one unique displayName chain
        // where in@value == out@value and the displayName is identical to an adjacent node.
        // In practice: nodes with the same displayName appearing in adjacent columns
        // where inflow == outflow are collapsed — the source's links skip directly to
        // the pass-through node's targets.
        function computePassThroughGraph(origNodes, origLinks, showPassThrough) {
            // Expanded mode: return data unchanged
            if (showPassThrough) return { nodes: origNodes, links: origLinks, fullNodes: origNodes, fullLinks: origLinks };

            // Collapsed mode: remove pure pass-through nodes — nodes where every unit
            // that flows in also flows straight back out to a SINGLE successor that shares
            // the same display name (e.g. Aviva@1 whose only outbound link is to Aviva@2).
            //
            // Detection rules for a collapsible pass-through node N:
            //   1. N has exactly ONE outbound link (to a single successor S).
            //   2. The display name of N equals the display name of S.
            //   3. Total inflow into N == value of the single outbound link (pure pass-through).
            //
            // When N is collapsed: every inbound link X→N is rewritten as X→S instead.
            // The link N→S itself is dropped. S keeps all its other inbound/outbound links.
            //
            // This is applied iteratively so chains longer than two (e.g. A@1→A@2→A@3) fully
            // collapse in a single call (each iteration removes one layer until no more remain).

            // Helper: display name for a node (mirrors displayNameFor() from the render layer)
            const nodeMap = {};
            origNodes.forEach(n => { nodeMap[n.name] = n; });
            function dispName(nodeName) {
                const n = nodeMap[nodeName];
                if (!n) return nodeName.replace(/@\d+$/, '');
                if (n.label !== undefined) return n.label;
                if (n.displayName && n.displayName.trim()) return n.displayName.trim();
                return nodeName.replace(/@\d+$/, '');
            }

            let nodes = origNodes.slice();
            let links = origLinks.slice();

            let changed = true;
            while (changed) {
                changed = false;

                // Build adjacency info fresh each pass
                const outLinks = {};   // nodeName → [link, ...]
                const inLinks  = {};   // nodeName → [link, ...]
                nodes.forEach(n => { outLinks[n.name] = []; inLinks[n.name] = []; });
                links.forEach(l => {
                    if (outLinks[l.source]) outLinks[l.source].push(l);
                    if (inLinks[l.target])  inLinks[l.target].push(l);
                });

                const removeSet = new Set();
                const redirect  = {};  // removedNode → successorName

                nodes.forEach(n => {
                    const outs = outLinks[n.name] || [];
                    const ins  = inLinks[n.name]  || [];
                    if (ins.length === 0) return;   // source node — never collapse
                    if (outs.length !== 1) return;  // must have exactly one outbound link

                    const successor = outs[0].target;
                    if (successor === n.name) return; // self-loop guard

                    // Display names must match
                    if (dispName(n.name) !== dispName(successor)) return;

                    // Total inflow must equal the single outbound value (pure pass-through)
                    const totalIn  = ins.reduce((s, l) => s + l.value, 0);
                    const totalOut = outs[0].value;
                    if (Math.abs(totalIn - totalOut) > 1e-9) return;

                    removeSet.add(n.name);
                    redirect[n.name] = successor;
                });

                if (removeSet.size === 0) break;

                // Rewrite links: X → removed becomes X → redirect[removed]
                const newLinks = [];
                links.forEach(l => {
                    if (removeSet.has(l.source)) return; // drop the N→S link itself
                    if (removeSet.has(l.target)) {
                        // Redirect X → removed  to  X → successor
                        // Merge with an existing X→successor link if one was already added
                        const newTarget = redirect[l.target];
                        const existing = newLinks.find(x => x.source === l.source && x.target === newTarget);
                        if (existing) {
                            existing.value += l.value;
                        } else {
                            newLinks.push({ source: l.source, target: newTarget, value: l.value, color: l.color });
                        }
                    } else {
                        newLinks.push(l);
                    }
                });

                nodes = nodes.filter(n => !removeSet.has(n.name));
                links = newLinks;
                changed = true; // run another pass to catch chains
            }

            // Pin each surviving node to its column rank from the *original* expanded graph.
            // Without this, collapsed successors (e.g. Aviva@2) get pulled left by
            // assignColumns because their only predecessor is now Bundled Providers (rank 0),
            // placing them at rank 1 instead of rank 2 where they sat in expanded mode.
            // Stamping the original rank as node.column forces assignColumns to keep them right.
            const origRank = assignColumnsRaw(origNodes.map(n => n.name), origLinks);
            nodes = nodes.map(n => {
                const r = origRank[n.name];
                if (r === undefined) return n;
                // Only override if not already manually pinned by the user
                if (typeof n.column === 'number') return n;
                return { ...n, column: r };
            });

            return { nodes, links, fullNodes: origNodes, fullLinks: origLinks };
        }

        // Thin wrapper used by computePassThroughGraph before generateDiagram's local
        // assignColumns closure exists — same algorithm, operates on raw name/link arrays.
        function assignColumnsRaw(nodeNames, links) {
            const rank = {};
            nodeNames.forEach(n => { rank[n] = 0; });
            const incoming = {};
            nodeNames.forEach(n => { incoming[n] = []; });
            links.forEach(l => { if (incoming[l.target]) incoming[l.target].push(l.source); });
            let changed = true;
            while (changed) {
                changed = false;
                for (const n of nodeNames) {
                    if (!incoming[n].length) continue;
                    const maxP = Math.max(...incoming[n].map(p => rank[p] !== undefined ? rank[p] : 0));
                    if (maxP + 1 > rank[n]) { rank[n] = maxP + 1; changed = true; }
                }
            }
            return rank;
        }


        // locale: undefined in the browser (unchanged app behaviour); the CLI pins 'en-US'
        // so output does not depend on the machine's locale.
        function formatFlowValue(v, locale) {
            if (Math.abs(v) >= 1000) return v.toLocaleString(locale, { maximumFractionDigits: 0 });
            return v.toLocaleString(locale, { maximumFractionDigits: 1 });
        }

        // Assigns each node to a column (rank) by longest-path-from-source, so the
        // diagram reads left-to-right in true topological order regardless of the
        // order nodes/links were entered in.
        function assignColumns(nodeNames, validLinks, nodeList) {
            const rank = {};
            // Seed from explicit node.column declarations first — the forward pass can only
            // push ranks higher, never lower, so a declared column acts as a guaranteed floor.
            nodeNames.forEach(n => {
                const nodeObj = nodeList ? nodeList.find(nd => nd.name === n) : null;
                rank[n] = (nodeObj && typeof nodeObj.column === 'number') ? nodeObj.column : 0;
            });
            const incoming = {};
            nodeNames.forEach(n => incoming[n] = []);
            validLinks.forEach(l => incoming[l.target] && incoming[l.target].push(l.source));

            let changed = true;
            let iterations = 0;
            const maxIterations = nodeNames.length + 2;
            while (changed && iterations < maxIterations) {
                changed = false;
                iterations++;
                for (const n of nodeNames) {
                    const preds = incoming[n];
                    if (!preds.length) continue;
                    const maxPredRank = Math.max(...preds.map(p => rank[p] !== undefined ? rank[p] : 0));
                    if (maxPredRank + 1 > rank[n]) {
                        rank[n] = maxPredRank + 1;
                        changed = true;
                    }
                }
            }
            return rank;
        }

        // Two-pass proportional height sizing: proportional share first, floored at a
        // minimum so thin flows stay legible; if the floor pushes the total past what's
        // available, every node scales down by the same factor so the column never overflows.
        // globalTotal: if provided, heights are proportional to the diagram-wide total rather
        // than just this column's sum — keeps collapsed intermediate columns correctly scaled.
        function layoutColumn(colNodes, usableH, topPad, gap, globalTotal) {
            const colTotal = colNodes.reduce((sum, n) => sum + n.value, 0) || 1;
            const total = globalTotal || colTotal;
            const totalGap = gap * Math.max(colNodes.length - 1, 0);
            const available = Math.max(usableH - totalGap, 0);

            const MIN_NODE_H = 6;
            const rawHeights = colNodes.map(n => n.value > 0 ? Math.max((n.value / total) * available, MIN_NODE_H) : 0);
            const rawTotal = rawHeights.reduce((sum, h) => sum + h, 0) || 1;
            // Only scale down if overflowing; never scale up (column may be a subset of global).
            const scale = rawTotal > available ? available / rawTotal : 1;

            const totalUsed = rawHeights.reduce((s, h) => s + h * scale, 0) + totalGap;
            let y = topPad + (usableH - totalUsed) / 2;

            return colNodes.map((n, i) => {
                const h = rawHeights[i] * scale;
                const seg = { ...n, y0: y, y1: y + h };
                y += h + gap;
                return seg;
            });
        }

        // ---- Semantic palette resolution (research: restrained neutral base + 1-2 hero accents) ----
        // A node is treated as a "profit/margin" destination or a "cost" destination by matching
        // its name against common financial vocabulary. This is intentionally just a default
        // heuristic for the restrained mode — any node can still be recolored manually, and the
        // Branded mode bypasses this entirely and uses each node's own assigned color throughout.
        const PROFIT_WORDS = /\b(profit|margin|income|earning|net income|ebit|ebitda)\b/i;
        const COST_WORDS = /\b(cost|expense|opex|capex|loss|tax(es)?|spend(ing)?)\b/i;

        function semanticRole(name) {
            if (PROFIT_WORDS.test(name)) return 'profit';
            if (COST_WORDS.test(name)) return 'cost';
            return 'neutral';
        }

        function resolveNodeColor(name, explicitColorRef, paletteMode, themePalette) {
            if (paletteMode === 'branded' || paletteMode === 'house') return explicitColorRef ? resolveThemeColor(explicitColorRef, themePalette) : 'var(--sk-neutral-node)';
            const role = semanticRole(name);
            if (role === 'profit') return 'var(--sk-accent-profit)';
            if (role === 'cost') return 'var(--sk-accent-cost)';
            return 'var(--sk-neutral-node)';
        }

        function resolveRibbonColor(targetName, targetExplicitColorRef, paletteMode, themePalette) {
            if (paletteMode === 'branded' || paletteMode === 'house') return targetExplicitColorRef ? resolveThemeColor(targetExplicitColorRef, themePalette) : 'var(--sk-neutral-ribbon)';
            const role = semanticRole(targetName);
            if (role === 'profit') return 'var(--sk-accent-profit)';
            if (role === 'cost') return 'var(--sk-accent-cost)';
            return 'var(--sk-neutral-ribbon)';
        }

        function escapeHtml(s) {
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        function escapeAttr(s) {
            return escapeHtml(s).replace(/"/g, '&quot;');
        }

        // ---- The renderer ----
        // Returns { status: 'empty' | 'no-valid-flows' } when there is nothing to draw (the page
        // shows its placeholder), else { status: 'ok', W, H, body, ribbons, validLinks, numCols }
        // where body is the inner SVG markup exactly as generateDiagram() used to build it.
        function renderDiagramBody(state, env) {
            env = env || {};
            const nodes = state.nodes || [];
            const links = state.links || [];
            const columnLabels = state.columnLabels || [];
            const paletteMode = state.paletteMode || 'restrained';
            const ribbonStyle = state.ribbonStyle || 'standard';
            const isPro = ribbonStyle === 'pro';
            const ribbonColorMode = (state.ribbonColorMode === 'source' || state.ribbonColorMode === 'target') ? state.ribbonColorMode : 'auto';
            const titleText = (state.title && String(state.title).trim()) || '';
            const captionText = (state.caption && String(state.caption).trim()) || '';
            const diagramAspect = state.diagramAspect || '16:9';
            const showValues = state.showValues !== undefined ? state.showValues : true;
            const showPassThrough = !!state.showPassThrough;
            const globalOpacityValue = state.globalOpacityValue !== undefined ? state.globalOpacityValue : 0.45;
            const themePalette = state.themePalette || (paletteMode === 'house' ? HOUSE_THEME_PALETTE : DEFAULT_THEME_PALETTE);
            const rawMeasureTextWidth = env.measureTextWidth || (isPro ? createSelawikMeasurer() : createInterMeasurer());
            // Opt-in minimum word gap (em). Selawik's native space is ~0.27em and can
            // collapse at small sizes; 0.40em is the job-tested floor. Off by default.
            const wordGapEm = (typeof state.wordGapEm === 'number' && Number.isFinite(state.wordGapEm) && state.wordGapEm > 0) ? state.wordGapEm : 0;
            function wordGapExtraPx(font) {
                if (!wordGapEm) return 0;
                const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
                const size = m ? parseFloat(m[1]) : (isPro ? 13 : 12.5);
                const native = rawMeasureTextWidth(' ', font);
                return Math.max(0, wordGapEm * size - native);
            }
            function wordSpacingAttr(font) {
                const extra = wordGapExtraPx(font);
                return extra > 0 ? ` word-spacing="${+extra.toFixed(3)}"` : '';
            }
            const measureTextWidth = !wordGapEm ? rawMeasureTextWidth : function measureWithWordGap(text, font) {
                const spaces = (String(text).match(/ /g) || []).length;
                return rawMeasureTextWidth(text, font) + spaces * wordGapExtraPx(font);
            };
            const locale = env.locale;

            const formatFlowValue = (v) => formatFlowValueL(v, locale);
            const resolveThemeColorP = (ref) => resolveThemeColor(ref, themePalette);
            const resolveNodeColorP = (name, ref) => resolveNodeColor(name, ref, paletteMode, themePalette);
            const resolveRibbonColorP = (name, ref) => resolveRibbonColor(name, ref, paletteMode, themePalette);

            if (!nodes.length || !links.length) return { status: 'empty' };

            // Apply pass-through collapsing if the toggle is off
            const { nodes: renderNodes, links: renderLinks, fullNodes, fullLinks } = computePassThroughGraph(nodes, links, showPassThrough);

            const nodeIndex = {};
            renderNodes.forEach((n, i) => nodeIndex[n.name] = i);
            const validLinks = renderLinks.filter(l => nodeIndex[l.source] !== undefined && nodeIndex[l.target] !== undefined && l.value > 0);

            if (!validLinks.length) return { status: 'no-valid-flows' };

            // ---- Column assignment ----
            const nodeNames = renderNodes.map(n => n.name);
            const rank = assignColumns(nodeNames, validLinks, renderNodes);
            const maxRank = Math.max(...Object.values(rank));
            const numCols = maxRank + 1;

            const colNodeNames = Array.from({ length: numCols }, () => []);
            nodeNames.forEach(name => { colNodeNames[rank[name]].push(name); });

            function nodeValue(name) {
                const nodeObj = renderNodes.find(n => n.name === name);
                if (nodeObj && typeof nodeObj.value === 'number' && nodeObj.value > 0) {
                    return nodeObj.value;
                }
                const inflow = validLinks.filter(l => l.target === name).reduce((s, l) => s + l.value, 0);
                const outflow = validLinks.filter(l => l.source === name).reduce((s, l) => s + l.value, 0);
                return inflow > 0 ? inflow : outflow;
            }

            function displayNameFor(name) {
                const nodeObj = renderNodes.find(n => n.name === name);
                if (!nodeObj) return name.replace(/@\d+$/, '');
                // node.label takes highest priority — explicitly set to "" means suppress
                if (nodeObj.label !== undefined) return nodeObj.label;
                // node.displayName (series model)
                if (nodeObj.displayName && nodeObj.displayName.trim()) return nodeObj.displayName.trim();
                // Final fallback: strip @N suffix so internal identity keys never leak into labels
                return name.replace(/@\d+$/, '');
            }

            // ---- Sizing ----
            // Core contract: every node in every column gets a visible label. W grows (and
            // H follows via the aspect ratio) until that's true. The sequence is:
            //   1. Fix font, measure all label text widths → margins + min plot width (horizontal)
            //   2. Compute min H needed so every column's labels stack without overlap (vertical)
            //   3. minW = max(containerW, horizontalMin, ceil(minH / aspectRatio))
            //   4. H = round(W × aspectRatio) — always exact, never approximated
            const containerW = env.containerW || 900;

            function valueFontFor(f) {
                const m = f.match(/(\d+(?:\.\d+)?)px/);
                if (isPro) return `400 ${m ? parseFloat(m[1]) : 12.5}px "Segoe UI", Selawik, Helvetica, Arial, sans-serif`;
                return `700 ${m ? parseFloat(m[1]) - 1 : 11.5}px Inter, system-ui, sans-serif`;
            }

            const baseLabelSize = isPro ? 13 : 12.5;
            const labelFontSize = baseLabelSize;
            const valueFontSize = isPro ? 12.5 : (labelFontSize - 1);
            const fontStack = isPro ? '"Segoe UI", Selawik, Helvetica, Arial, sans-serif' : 'Inter, system-ui, sans-serif';
            const labelFontStr  = isPro ? `600 ${labelFontSize}px ${fontStack}` : `600 ${labelFontSize}px Inter, system-ui, sans-serif`;
            const lineHeight    = isPro ? labelFontSize * 1.2 : labelFontSize * 1.05;
            const valueLineH    = isPro ? valueFontSize * 1.2 : lineHeight;
            // Label block height for one node: name line(s) + value line + inter-node gap.
            // We don't know wrap yet, so use 1 name line as the floor; wrapping only increases it.
            const labelBlockH   = isPro ? (lineHeight + valueLineH + 8) : (lineHeight * 2 + 4); // name + value + gap between nodes

            function wrapToFit(name, maxW) {
                if (measureTextWidth(name, labelFontStr) <= maxW) return [name];
                const words = name.split(' ');
                if (words.length === 1) return [name];
                let line1 = words[0], i = 1;
                for (; i < words.length; i++) {
                    const cand = line1 + ' ' + words[i];
                    if (measureTextWidth(cand, labelFontStr) > maxW) break;
                    line1 = cand;
                }
                const line2 = words.slice(i).join(' ');
                return line2 ? [line1, line2] : [name];
            }

            // Unconstrained label width per node (name or value, whichever is wider).
            function rawLabelW(name) {
                const dn = displayNameFor(name);
                if (!dn) return 0;
                return Math.max(
                    measureTextWidth(dn, labelFontStr),
                    measureTextWidth(formatFlowValue(nodeValue(name)), valueFontFor(labelFontStr))
                );
            }
            const colLabelW = colNodeNames.map(names => Math.max(0, ...names.map(rawLabelW)));

            // ── Horizontal: margins + minimum plot width ──────────────────────────────
            const leaderPad = isPro ? 26 : 22; // leader + text-gap + node-edge (+ a little extra in pro)
            const edgePad = isPro ? 16 : 0;
            const leftMargin  = Math.ceil(colLabelW[0] + leaderPad) + edgePad;
            const rightMargin = Math.ceil(colLabelW[numCols - 1] + leaderPad) + edgePad;

            // Each middle column needs colLabelW[c] + leaderPad on each side of itself.
            // Inter-column gap must be ≥ (left neighbour half-req + right neighbour half-req).
            // Conservatively: gap ≥ maxMidLabelW + leaderPad*2 for all middle columns.
            const maxMidLabelW = numCols > 2
                ? Math.max(...colNodeNames.slice(1, numCols - 1).map(
                    names => Math.max(0, ...names.map(rawLabelW))))
                : 0;
            const minInterColGap  = Math.max(isPro ? 96 : 80, maxMidLabelW + leaderPad * 2);
            const minPlotWidth    = Math.max(160, Math.ceil(minInterColGap * Math.max(numCols - 1, 1)));

            // ── Vertical: minimum H so every column's labels fit without overlap ──────
            const hasColLabels = columnLabels.some(l => l && l.trim());
            const hasMiddleCols = numCols > 2;
            const titleH = (isPro && titleText) ? 36 : 0;
            const captionH = (isPro && captionText) ? 32 : 0;
            const topPad    = titleH + (hasColLabels ? (isPro ? 36 : 42) : (hasMiddleCols ? (isPro ? 24 : 28) : (isPro ? 16 : 18)));
            const bottomPad = (isPro ? 16 : 18) + captionH;
            // For each column, minUsableH = nodeCount × labelBlockH (labels never overlap).
            const minUsableH = Math.max(...colNodeNames.map(names => names.length * labelBlockH));
            const minH = minUsableH + topPad + bottomPad;

            // ── W: satisfy horizontal AND vertical constraints ────────────────────────
            const aspectRatio = diagramAspect === '4:3' ? 3/4
                               : diagramAspect === 'portrait' ? 4/3
                               : 9/16; // 16:9
            const minWForH = Math.ceil(minH / aspectRatio);
            const W = Math.max(containerW, leftMargin + rightMargin + minPlotWidth, isPro ? 0 : minWForH);

            // ── H: existing styles lock to the aspect ratio; pro fits the content tightly ─
            const plotHeight = (typeof state.plotHeight === 'number' && Number.isFinite(state.plotHeight)) ? state.plotHeight : null;
            const usableH = isPro ? Math.max(minUsableH, plotHeight || 400) : (Math.round(W * aspectRatio) - topPad - bottomPad);
            const H = isPro ? (topPad + usableH + bottomPad) : Math.round(W * aspectRatio);

            // ── wrappedLabel: now W is final, compute actual wrap budget per column ───
            const plotWidthActual = W - leftMargin - rightMargin;
            const interColGap = numCols > 1 ? plotWidthActual / (numCols - 1) : plotWidthActual;
            const wrappedLabel = {};
            colNodeNames.forEach((names, c) => {
                const isEdge = c === 0 || c === numCols - 1;
                const maxW = isEdge
                    ? (c === 0 ? leftMargin - leaderPad : rightMargin - leaderPad)
                    : Math.max(40, interColGap / 2 - leaderPad);
                names.forEach(n => {
                    const dn = displayNameFor(n);
                    wrappedLabel[n] = dn ? wrapToFit(dn, Math.max(40, maxW)) : [];
                });
            });
            const leftWraps  = colNodeNames[0].some(n => wrappedLabel[n].length > 1);
            const rightWraps = colNodeNames[numCols-1].some(n => wrappedLabel[n].length > 1);

            const nodeThickness = isPro ? 8 : 12;
            const plotLeft = leftMargin;
            const plotRight = W - rightMargin;
            const plotWidth = Math.max(plotRight - plotLeft, 100);
            const colX = Array.from({ length: numCols }, (_, i) =>
                numCols === 1 ? plotLeft + plotWidth / 2 : plotLeft + (plotWidth - nodeThickness) * (i / (numCols - 1)) + nodeThickness / 2
            );

            // ---- Build + lay out each column ----
            // Generous gap (research: premium examples use noticeably more vertical
            // breathing room between nodes than default chart-library packing).
            const gapFor = (count) => isPro
                ? Math.max(10, Math.min(32, 480 / Math.max(count, 1)))
                : Math.max(8, Math.min(30, 420 / Math.max(count, 1)));
            // Global total: the largest column sum across all columns. Used so every column
            // scales its node heights against the same universe — critical when collapsed
            // intermediate columns (e.g. only Mercer@2 + Lifesight@2 visible) would otherwise
            // stretch to fill the full height instead of matching the scale of adjacent columns.
            const globalTotal = Math.max(...colNodeNames.map(names =>
                names.reduce((s, name) => s + nodeValue(name), 0)
            ));
            // Build the expanded-graph column layout (all nodes, pre-collapse) so residual
            // nodes inherit their exact y0/y1 positions from the full column rather than
            // being re-packed amongst themselves. Ghost nodes (collapsed away) act as
            // invisible spacers that still consume their share of vertical space.
            const expandedColLayout = (() => {
                const origRankMap = assignColumns(fullNodes.map(n => n.name), fullLinks, fullNodes);
                const origMaxRank = Math.max(...Object.values(origRankMap));
                const origColBuckets = Array.from({ length: origMaxRank + 1 }, () => []);
                // Build a value map from the full (pre-collapse) links so ghost @1 nodes
                // get their correct sizes even though they're absent from validLinks.
                const fullValueMap = {};
                fullLinks.forEach(l => {
                    fullValueMap[l.target] = (fullValueMap[l.target] || 0) + l.value;
                });
                fullNodes.forEach(n => {
                    if (!fullValueMap[n.name]) {
                        // Source node: use outflow
                        fullValueMap[n.name] = fullLinks.filter(l => l.source === n.name).reduce((s,l) => s+l.value, 0);
                    }
                });
                const fullNodeIndex = {};
                fullNodes.forEach((n,i) => fullNodeIndex[n.name] = i);
                fullNodes.forEach(n => {
                    const r = origRankMap[n.name];
                    if (r !== undefined) origColBuckets[r].push({
                        name: n.name,
                        color: (fullNodeIndex[n.name] !== undefined && fullNodes[fullNodeIndex[n.name]] && fullNodes[fullNodeIndex[n.name]].color) || '#94a3b8',
                        value: fullValueMap[n.name] || 0,
                        order: fullNodes[fullNodeIndex[n.name]] && fullNodes[fullNodeIndex[n.name]].order
                    });
                });
                // Layout each original column the same way the real layout does,
                // so y0/y1 coordinates are directly comparable.
                const posMap = {};
                origColBuckets.forEach(col => {
                    const sorted = sortColumnNodes(col);
                    const laid = layoutColumn(sorted, usableH, topPad, gapFor(sorted.length), globalTotal);
                    laid.forEach(seg => { posMap[seg.name] = seg; });
                });
                return posMap;
            })();

            function sortColumnNodes(col) {
                // Optional node.order: when every node in the column has a numeric
                // order, use it (low = top). Otherwise keep the default value-desc sort.
                const allOrdered = col.every(n => typeof n.order === 'number');
                if (allOrdered) return [...col].sort((a, b) => a.order - b.order);
                return [...col].sort((a, b) => b.value - a.value);
            }

            const laidOut = colNodeNames.map(names => {
                const colNodes = names.map(name => ({
                    name,
                    color: (renderNodes[nodeIndex[name]] && renderNodes[nodeIndex[name]].color) || '#94a3b8',
                    value: nodeValue(name),
                    order: renderNodes[nodeIndex[name]] && renderNodes[nodeIndex[name]].order
                }));

                // If every node in this column has a position from the expanded layout,
                // use those positions directly (preserves exact y0/y1 from the full column).
                // Otherwise fall back to a fresh pack (e.g. the @2 column or endpoints).
                const allHaveExpanded = colNodes.every(n => expandedColLayout[n.name]);
                if (allHaveExpanded) {
                    return colNodes.map(n => ({ ...n, ...expandedColLayout[n.name] }));
                }

                const sorted = sortColumnNodes(colNodes);
                return layoutColumn(sorted, usableH, topPad, gapFor(sorted.length), globalTotal);
            });
            const byKeyPerCol = laidOut.map(col => new Map(col.map(n => [n.name, n])));

            // ---- Ribbons ----
            const sourceCursors = new Map();
            const targetCursors = new Map();
            laidOut.forEach(col => col.forEach(n => {
                sourceCursors.set(n.name, n.y0);
                targetCursors.set(n.name, n.y0);
            }));

            const linksByRank = [...validLinks].sort((a, b) => {
                const ra = rank[a.source], rb = rank[b.source];
                if (ra !== rb) return ra - rb;
                const sa = renderNodes[nodeIndex[a.source]] && renderNodes[nodeIndex[a.source]].order;
                const sb = renderNodes[nodeIndex[b.source]] && renderNodes[nodeIndex[b.source]].order;
                if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb) return sa - sb;
                const ta = renderNodes[nodeIndex[a.target]] && renderNodes[nodeIndex[a.target]].order;
                const tb = renderNodes[nodeIndex[b.target]] && renderNodes[nodeIndex[b.target]].order;
                if (typeof ta === 'number' && typeof tb === 'number' && ta !== tb) return ta - tb;
                return b.value - a.value;
            });

            const ribbons = linksByRank.map(l => {
                const sRank = rank[l.source], tRank = rank[l.target];
                const sNode = byKeyPerCol[sRank].get(l.source);
                const tNode = byKeyPerCol[tRank].get(l.target);
                if (!sNode || !tNode) return null;

                const sy0 = sourceCursors.get(l.source);
                const sy1 = sy0 + (sNode.y1 - sNode.y0) * (l.value / sNode.value);
                sourceCursors.set(l.source, sy1);

                const ty0 = targetCursors.get(l.target);
                const ty1 = ty0 + (tNode.y1 - tNode.y0) * (l.value / tNode.value);
                targetCursors.set(l.target, ty1);

                // In branded/house mode (existing styles) every ribbon gets a source→target
                // gradient. Pro uses a solid fill (no cross-hue gradient). Colouring is
                // --ribbon source|target|auto (default auto): auto uses the target colour
                // for last-column inflows and for outflows from a pooling/intermediate
                // node, and the source colour otherwise. Ink and dark slate fills are
                // avoided (other end, or a light neutral fallback).
                const useThemeColors = paletteMode === 'branded' || paletteMode === 'house';
                const srcColor = !isPro && useThemeColors && sNode.color ? resolveThemeColorP(sNode.color) : null;
                const tgtColor = !isPro && useThemeColors && tNode.color ? resolveThemeColorP(tNode.color) : null;
                const srcHasIn = validLinks.some(x => x.target === l.source);
                const srcHasOut = validLinks.some(x => x.source === l.source);
                return {
                    source: l.source, target: l.target, value: l.value,
                    sRank, tRank, sy0, sy1, ty0, ty1,
                    fillColor: isPro
                        ? pickProRibbonFill(
                            resolveNodeColorP(l.source, sNode.color),
                            resolveNodeColorP(l.target, tNode.color),
                            ribbonColorMode, sRank, tRank, numCols, srcHasIn && srcHasOut)
                        : resolveRibbonColorP(l.target, tNode.color),
                    sourceColor: srcColor,
                    targetColorRaw: tgtColor,
                };
            }).filter(Boolean);


            // ---- Build SVG ----
            let svg = '';
            svg += `<rect class="sk-canvas-bg" x="0" y="0" width="${W}" height="${H}" fill="var(--sk-canvas)"/>`;

            function ribbonPath(x0, x1, r) {
                const midX = (x0 + x1) / 2;
                return `M ${x0} ${r.sy0}
                    C ${midX} ${r.sy0}, ${midX} ${r.ty0}, ${x1} ${r.ty0}
                    L ${x1} ${r.ty1}
                    C ${midX} ${r.ty1}, ${midX} ${r.sy1}, ${x0} ${r.sy1} Z`;
            }

            // ---- Ribbon style defs ----
            // Three deliberately restrained looks, not three different chart types — every
            // ribbon still carries the same geometry and color logic. The style only changes
            // how the fill is finished, so switching styles never changes what the diagram says.
            let ribbonDefs = '';
            if (ribbonStyle === 'classic') {
                // Verified by rendering and screenshotting multiple candidates at both swatch
                // size and realistic on-canvas ribbon thickness (thin ribbons can't carry as
                // much visible grain as a large test swatch suggests). Two layers: a gentle
                // edge softness so the boundary loses its perfectly vector crispness, plus a
                // DIRECTIONAL streak texture (markedly different x/y baseFrequency, so the
                // noise stretches along the flow's own horizontal axis) — this is what reads
                // as an actual brush stroke rather than generic noise. An isotropic (same-
                // frequency-both-axes) grain layer was tried first and was barely visible at
                // real ribbon thickness; the directional version stayed visible at any width.
                // A separate highlight-streak variant using a feColorMatrix with a negative
                // alpha bias was also tried and rejected — it introduced visible color fringing
                // (the negative coefficient pushed some channels below zero unpredictably).
                ribbonDefs += `
                    <filter id="sk-brush-filter" x="-5%" y="-5%" width="110%" height="110%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.02 0.05" numOctaves="3" seed="11" result="edgeNoise"/>
                        <feDisplacementMap in="SourceGraphic" in2="edgeNoise" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="displaced"/>
                        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.35" numOctaves="2" seed="5" result="streaks"/>
                        <feColorMatrix in="streaks" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.32 0.32 0.32 0 0" result="streaksAlpha"/>
                        <feComposite in="streaksAlpha" in2="SourceAlpha" operator="in" result="streaksClipped"/>
                        <feMerge>
                            <feMergeNode in="displaced"/>
                            <feMergeNode in="streaksClipped"/>
                        </feMerge>
                    </filter>`;
            } else if (ribbonStyle === 'modern') {
                // Soft top-edge highlight + gentle drop shadow, suggesting a glossy/lit surface
                // without literal blur-everything glassmorphism — the ribbon stays a flat,
                // legible color underneath; the gloss is a thin overlay, not the whole fill.
                ribbonDefs += `
                    <filter id="sk-glass-shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#1c2127" flood-opacity="0.10"/>
                    </filter>
                    <linearGradient id="sk-glass-sheen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.38"/>
                        <stop offset="35%" stop-color="#ffffff" stop-opacity="0.08"/>
                        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
                    </linearGradient>`;
            }
            if (ribbonDefs) svg += `<defs>${ribbonDefs}</defs>`;

            // Build gradient defs for cross-colour ribbons (branded mode, different source/target colours).
            // IMPORTANT: gradientUnits="userSpaceOnUse" with absolute coordinates, NOT
            // "objectBoundingBox". PowerPoint's SVG import goes through a DrawingML
            // conversion layer (not a real SVG renderer) that reliably fails to resolve
            // objectBoundingBox gradients on <path> elements — the shape silently gets no
            // fill at all rather than falling back to a solid color. This was confirmed by
            // the reported symptom exactly: nodes (plain solid fills, no gradient) rendered
            // fine in PowerPoint, ribbons (objectBoundingBox gradients) vanished — while
            // both rendered correctly in a real SVG engine (Edge). userSpaceOnUse with
            // literal pixel coordinates computed per-ribbon (its own x0→x1 span) is the
            // standard workaround and renders identically in both engines.
            const gradientDefs = [];
            ribbons.forEach((r, ri) => {
                if (!r.sourceColor || !r.targetColorRaw) return;
                if (r.sourceColor === r.targetColorRaw) return; // same colour — no gradient needed
                const gx0 = colX[r.sRank], gx1 = colX[r.tRank];
                const gy = (r.sy0 + r.sy1 + r.ty0 + r.ty1) / 4; // representative y, irrelevant for a horizontal gradient but required by spec
                gradientDefs.push(`<linearGradient id="sk-ribbon-grad-${ri}" gradientUnits="userSpaceOnUse" x1="${gx0}" y1="${gy}" x2="${gx1}" y2="${gy}">
                    <stop offset="0%" stop-color="${r.sourceColor}"/>
                    <stop offset="100%" stop-color="${r.targetColorRaw}"/>
                </linearGradient>`);
                r.gradientId = `sk-ribbon-grad-${ri}`;
            });
            if (gradientDefs.length) svg += `<defs>${gradientDefs.join('')}</defs>`;

            ribbons.forEach(r => {
                const x0 = colX[r.sRank], x1 = colX[r.tRank];
                const d = ribbonPath(x0, x1, r);
                const filterAttr = ribbonStyle === 'classic' ? ' filter="url(#sk-brush-filter)"' : (ribbonStyle === 'modern' ? ' filter="url(#sk-glass-shadow)"' : '');
                const linkIdx = links.findIndex(l => l.source === r.source && l.target === r.target);
                const linkIdxAttr = linkIdx >= 0 ? ` data-link-index="${linkIdx}"` : '';
                const fill = r.gradientId ? `url(#${r.gradientId})` : r.fillColor;
                svg += `<path d="${d}" fill="${fill}" fill-opacity="${globalOpacityValue}"${filterAttr}${linkIdxAttr} class="sk-ribbon" data-source="${escapeAttr(r.source)}" data-target="${escapeAttr(r.target)}"><title>${escapeAttr(r.source)} → ${escapeAttr(r.target)}: ${formatFlowValue(r.value)}</title></path>`;
                if (ribbonStyle === 'modern') {
                    svg += `<path d="${d}" fill="url(#sk-glass-sheen)" class="sk-ribbon sk-ribbon-sheen"${linkIdxAttr} data-source="${escapeAttr(r.source)}" data-target="${escapeAttr(r.target)}" style="pointer-events:none;"/>`;
                }
            });

            // ---- Nodes ----
            laidOut.forEach((col, c) => {
                col.forEach(n => {
                    const x = colX[c] - nodeThickness / 2;
                    const fill = resolveNodeColorP(n.name, n.color);
                    const nodeRx = isPro ? 1 : 2;
                    const nodeStroke = isPro ? 'rgba(31,41,51,0.12)' : 'rgba(28,33,39,0.10)';
                    const nodeSw = isPro ? 0.75 : 1;
                    svg += `<rect x="${x}" y="${n.y0}" width="${nodeThickness}" height="${Math.max(n.y1 - n.y0, 1)}" rx="${nodeRx}" fill="${fill}" stroke="${nodeStroke}" stroke-width="${nodeSw}" class="sk-node" data-name="${escapeAttr(n.name)}"><title>${escapeAttr(n.name)}: ${formatFlowValue(n.value)}</title></rect>`;
                });
            });

            // ---- Labels ----
            // Edge columns: always show name + value, floating away from the plot into the margin.
            // Middle columns: float into inter-column gap, skip nodes too thin to be visible.

            if (!isPro) laidOut.forEach((col, c) => {
                const isLeft  = c === 0;
                const isRight = c === numCols - 1;
                const isEdge  = isLeft || isRight;
                // Left col: labels float left. Right col: labels float right.
                // Middle cols: left-of-centre float right, right-of-centre float left.
                const midCol = (numCols - 1) / 2;
                const labelOnRight = isLeft ? false : isRight ? true : c <= midCol;

                col.forEach(n => {
                    const midY = (n.y0 + n.y1) / 2;
                    const nodeHeight = n.y1 - n.y0;
                    // Middle columns skip invisible nodes; edge columns always label.
                    if (!isEdge && nodeHeight < 4) return;

                    const lines = wrappedLabel[n.name] || [];
                    if (!lines.length) return; // empty-string label override = suppress

                    const x = colX[c];
                    const edgeX = labelOnRight ? x + nodeThickness / 2 : x - nodeThickness / 2;
                    const leaderLen = 10;
                    const leaderEndX = labelOnRight ? edgeX + leaderLen : edgeX - leaderLen;
                    const textX = labelOnRight ? leaderEndX + 6 : leaderEndX - 6;
                    const anchor = labelOnRight ? 'start' : 'end';

                    // Edge columns always show values; middle columns respect showValues toggle.
                    const showVal = isEdge ? true : showValues;
                    const blockLines = lines.length + (showVal ? 1 : 0);
                    const blockH = blockLines * lineHeight;
                    let lineY = midY - blockH / 2 + lineHeight * 0.78;

                    svg += `<g class="sk-label" data-name="${escapeAttr(n.name)}">`;
                    svg += `<line x1="${edgeX}" y1="${midY}" x2="${leaderEndX}" y2="${midY}" class="sk-leader"/>`;
                    lines.forEach(line => {
                        svg += `<text x="${textX}" y="${lineY.toFixed(1)}" text-anchor="${anchor}" class="sk-label-name" font-size="${labelFontSize.toFixed(1)}"${wordSpacingAttr(labelFontStr)}>${escapeHtml(line)}</text>`;
                        lineY += lineHeight;
                    });
                    if (showVal) {
                        svg += `<text x="${textX}" y="${lineY.toFixed(1)}" text-anchor="${anchor}" class="sk-label-value" font-size="${valueFontSize.toFixed(1)}"${wordSpacingAttr(valueFontFor(labelFontStr))}>${formatFlowValue(n.value)}</text>`;
                    }
                    svg += `</g>`;
                });
            });


            if (isPro) {
                // Edge columns: labels sit in the outer margins with a slanted leader if nudged.
                // Middle columns: a compact name+value block in a solid canvas-coloured pill,
                // placed to the right of the node, or to the left if there isn't room.
                const labelGap = 4;
                const pillGap = 6;
                const pillPadX = 6;
                const pillPadY = 3;
                const pillRx = 4;
                const plotTop = topPad;
                const plotBot = H - bottomPad;
                const valueFontStr = valueFontFor(labelFontStr);
                const inlineGap = 6;

                function compactMidLabel(name, value, maxW, showVal) {
                    const dn = displayNameFor(name);
                    if (!dn) return null;
                    const valueStr = showVal ? formatFlowValue(value) : '';
                    const nameW = measureTextWidth(dn, labelFontStr);
                    const valW = valueStr ? measureTextWidth(valueStr, valueFontStr) : 0;
                    if (showVal && nameW + inlineGap + valW <= maxW) {
                        return { lines: [dn], valueStr, valueOnSameLine: true, contentW: nameW + inlineGap + valW, blockH: lineHeight, nameW };
                    }
                    if (nameW <= maxW) {
                        const lines = [dn];
                        const contentW = Math.max(nameW, valW);
                        const blockH = lineHeight + (showVal ? valueLineH : 0);
                        return { lines, valueStr, valueOnSameLine: false, contentW, blockH, nameW };
                    }
                    const lines = wrapToFit(dn, Math.max(40, maxW));
                    const lineWs = lines.map(line => measureTextWidth(line, labelFontStr));
                    const contentW = Math.max(...lineWs, valW);
                    const blockH = lines.length * lineHeight + (showVal ? valueLineH : 0);
                    return { lines, valueStr, valueOnSameLine: false, contentW, blockH, nameW: lineWs[0] || 0 };
                }

                laidOut.forEach((col, c) => {
                    const isLeft  = c === 0;
                    const isRight = c === numCols - 1;
                    const isEdge  = isLeft || isRight;
                    if (isEdge) {
                        const labelOnRight = isRight;
                        const candidates = [];
                        col.forEach(n => {
                            const midY = (n.y0 + n.y1) / 2;
                            const lines = wrappedLabel[n.name] || [];
                            if (!lines.length) return;
                            const showVal = true;
                            const blockH = lines.length * lineHeight + valueLineH;
                            candidates.push({ n, midY, lines, showVal, blockH });
                        });
                        const mids = spreadLabelMids(candidates.map(it => ({ midY: it.midY, blockH: it.blockH })), plotTop, plotBot, labelGap);
                        candidates.forEach((it, i) => {
                            const n = it.n;
                            const midY = mids[i];
                            const nodeMidY = it.midY;
                            const x = colX[c];
                            const edgeX = labelOnRight ? x + nodeThickness / 2 : x - nodeThickness / 2;
                            const leaderLen = 12;
                            const leaderEndX = labelOnRight ? edgeX + leaderLen : edgeX - leaderLen;
                            const textX = labelOnRight ? leaderEndX + 6 : leaderEndX - 6;
                            const anchor = labelOnRight ? 'start' : 'end';
                            let lineY = midY - it.blockH / 2 + lineHeight * 0.78;
                            svg += `<g class="sk-label" data-name="${escapeAttr(n.name)}">`;
                            svg += `<line x1="${edgeX}" y1="${nodeMidY}" x2="${leaderEndX}" y2="${midY}" class="sk-leader"/>`;
                            it.lines.forEach(line => {
                                svg += `<text x="${textX}" y="${lineY.toFixed(1)}" text-anchor="${anchor}" class="sk-label-name" font-size="${labelFontSize.toFixed(1)}"${wordSpacingAttr(labelFontStr)}>${escapeHtml(line)}</text>`;
                                lineY += lineHeight;
                            });
                            svg += `<text x="${textX}" y="${lineY.toFixed(1)}" text-anchor="${anchor}" class="sk-label-value" font-size="${valueFontSize.toFixed(1)}"${wordSpacingAttr(valueFontStr)}>${formatFlowValue(n.value)}</text>`;
                            svg += `</g>`;
                        });
                        return;
                    }

                    const roomRight = (c < numCols - 1 ? colX[c + 1] - nodeThickness / 2 : W - edgePad)
                        - (colX[c] + nodeThickness / 2) - pillGap;
                    const roomLeft = (colX[c] - nodeThickness / 2)
                        - (c > 0 ? colX[c - 1] + nodeThickness / 2 : edgePad) - pillGap;
                    const candidates = [];
                    col.forEach(n => {
                        const midY = (n.y0 + n.y1) / 2;
                        const nodeHeight = n.y1 - n.y0;
                        if (nodeHeight < 4) return;
                        const showVal = showValues;
                        const preferRight = roomRight >= roomLeft;
                        const firstBudget = Math.max(40, (preferRight ? roomRight : roomLeft) - 2 * pillPadX);
                        let layout = compactMidLabel(n.name, n.value, firstBudget, showVal);
                        if (!layout) return;
                        let onRight = preferRight;
                        const pillW = layout.contentW + 2 * pillPadX;
                        if (onRight && pillW > roomRight && layout.contentW + 2 * pillPadX <= roomLeft) onRight = false;
                        if (!onRight && pillW > roomLeft && layout.contentW + 2 * pillPadX <= roomRight) onRight = true;
                        // If the chosen side is still tight, re-compact to that side's budget.
                        const sideBudget = Math.max(40, (onRight ? roomRight : roomLeft) - 2 * pillPadX);
                        if (layout.contentW > sideBudget) {
                            layout = compactMidLabel(n.name, n.value, sideBudget, showVal) || layout;
                        }
                        const blockH = layout.blockH + 2 * pillPadY;
                        candidates.push({ n, midY, showVal, onRight, layout, blockH, pillW: layout.contentW + 2 * pillPadX });
                    });
                    const mids = spreadLabelMids(candidates.map(it => ({ midY: it.midY, blockH: it.blockH })), plotTop, plotBot, pillGap);
                    candidates.forEach((it, i) => {
                        const n = it.n;
                        const midY = mids[i];
                        const x = colX[c];
                        const edgeX = it.onRight ? x + nodeThickness / 2 : x - nodeThickness / 2;
                        const pillW = it.layout.contentW + 2 * pillPadX;
                        const pillH = it.blockH;
                        const pillX = it.onRight ? edgeX + pillGap : edgeX - pillGap - pillW;
                        const pillY = midY - pillH / 2;
                        const textLeft = pillX + pillPadX;
                        svg += `<g class="sk-label" data-name="${escapeAttr(n.name)}">`;
                        svg += `<rect class="sk-label-pill" x="${pillX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="${pillRx}" fill="var(--sk-canvas)"/>`;
                        let lineY = pillY + pillPadY + lineHeight * 0.78;
                        if (it.layout.valueOnSameLine) {
                            svg += `<text x="${textLeft.toFixed(1)}" y="${lineY.toFixed(1)}" text-anchor="start" class="sk-label-name" font-size="${labelFontSize.toFixed(1)}"${wordSpacingAttr(labelFontStr)}>${escapeHtml(it.layout.lines[0])}</text>`;
                            const valX = textLeft + it.layout.nameW + inlineGap;
                            svg += `<text x="${valX.toFixed(1)}" y="${lineY.toFixed(1)}" text-anchor="start" class="sk-label-value" font-size="${valueFontSize.toFixed(1)}"${wordSpacingAttr(valueFontStr)}>${escapeHtml(it.layout.valueStr)}</text>`;
                        } else {
                            it.layout.lines.forEach(line => {
                                svg += `<text x="${textLeft.toFixed(1)}" y="${lineY.toFixed(1)}" text-anchor="start" class="sk-label-name" font-size="${labelFontSize.toFixed(1)}"${wordSpacingAttr(labelFontStr)}>${escapeHtml(line)}</text>`;
                                lineY += lineHeight;
                            });
                            if (it.showVal && it.layout.valueStr) {
                                svg += `<text x="${textLeft.toFixed(1)}" y="${lineY.toFixed(1)}" text-anchor="start" class="sk-label-value" font-size="${valueFontSize.toFixed(1)}"${wordSpacingAttr(valueFontStr)}>${escapeHtml(it.layout.valueStr)}</text>`;
                            }
                        }
                        svg += `</g>`;
                    });
                });
            }

            // ---- Column labels (x-axis style, drawn in topPad space above the plot) ----
            // Only rendered when columnLabels[c] is a non-empty string for a given column.
            // Font size is capped so a long label can't overflow into an adjacent column's space.
            if (hasColLabels) {
                const colLabelY = topPad - 10;
                const colLabelFontSize = Math.min(12, labelFontSize);
                const colLabelFont = `600 ${colLabelFontSize}px Inter, system-ui, sans-serif`;
                for (let c = 0; c < numCols; c++) {
                    const label = columnLabels[c];
                    if (!label || !label.trim()) continue;
                    // Cap label to available column width to avoid overflow; truncate with ellipsis
                    // if necessary (same pattern as edge label wrapping).
                    const colBandW = numCols === 1 ? plotWidth
                        : c === 0 ? (colX[1] - colX[0]) * 0.9
                        : c === numCols - 1 ? (colX[c] - colX[c - 1]) * 0.9
                        : ((colX[Math.min(c + 1, numCols - 1)] - colX[Math.max(c - 1, 0)]) / 2) * 0.9;
                    let displayLabel = label.trim();
                    if (measureTextWidth(displayLabel, colLabelFont) > colBandW) {
                        while (displayLabel.length > 1 && measureTextWidth(displayLabel + '\u2026', colLabelFont) > colBandW) {
                            displayLabel = displayLabel.slice(0, -1);
                        }
                        displayLabel += '\u2026';
                    }
                    svg += `<text x="${colX[c].toFixed(1)}" y="${colLabelY.toFixed(1)}" text-anchor="middle" class="sk-col-label" font-size="${colLabelFontSize}"${wordSpacingAttr(colLabelFont)}>${escapeHtml(displayLabel)}</text>`;
                }
            }
            if (isPro && titleText) {
                const titleFontSize = 16;
                const titleY = 22;
                const titleFont = `600 ${titleFontSize}px ${fontStack}`;
                let displayTitle = titleText;
                const maxTitleW = W - edgePad * 2;
                if (measureTextWidth(displayTitle, titleFont) > maxTitleW) {
                    while (displayTitle.length > 1 && measureTextWidth(displayTitle + '\u2026', titleFont) > maxTitleW) {
                        displayTitle = displayTitle.slice(0, -1);
                    }
                    displayTitle += '\u2026';
                }
                svg += `<text x="${edgePad}" y="${titleY.toFixed(1)}" class="sk-title" font-size="${titleFontSize}"${wordSpacingAttr(titleFont)}>${escapeHtml(displayTitle)}</text>`;
            }
            if (isPro && captionText) {
                const capFontSize = 12.5;
                const capY = H - 14;
                const capFont = `400 ${capFontSize}px ${fontStack}`;
                let displayCap = captionText;
                const maxCapW = W - edgePad * 2;
                if (measureTextWidth(displayCap, capFont) > maxCapW) {
                    while (displayCap.length > 1 && measureTextWidth(displayCap + '\u2026', capFont) > maxCapW) {
                        displayCap = displayCap.slice(0, -1);
                    }
                    displayCap += '\u2026';
                }
                svg += `<text x="${edgePad}" y="${capY.toFixed(1)}" class="sk-caption" font-size="${capFontSize}"${wordSpacingAttr(capFont)}>${escapeHtml(displayCap)}</text>`;
            }
            return { status: 'ok', W, H, body: svg, ribbons, validLinks, numCols };
        }

        const formatFlowValueL = formatFlowValue;

        // Text for the <desc> accessibility summary (same wording as the page).
        function accessibleSummaryText(validLinks, locale) {
            const lines = validLinks.map(l => `${l.source} to ${l.target}: ${formatFlowValueL(l.value, locale)}`);
            return `Sankey diagram flows. ${lines.join('. ')}.`;
        }

        // ---- Export helpers (moved from index.html's getStyledSvgString; unchanged) ----
        const SK_TOKEN_VALUES = {
            '--sk-canvas': '#f7f5f1',
            '--sk-neutral-ribbon': '#aab1bd',
            '--sk-neutral-node': '#7c8694',
            '--sk-accent-profit': '#1f8a5f',
            '--sk-accent-cost': '#c0533e',
            '--sk-ink': '#1c2127',
            '--sk-ink-muted': '#767f8c'
        };
        function resolveTokens(str) {
            return str.replace(/var\((--[a-z-]+)\)/g, (m, token) => SK_TOKEN_VALUES[token] || m);
        }
        const EXPORT_STYLE_CSS = `
                .sk-leader { stroke: #c7c2b8; stroke-width: 1px; }
                .sk-label-name { font-family: Inter, system-ui, sans-serif; font-weight: 600; fill: #1c2127; letter-spacing: -0.006em; }
                .sk-label-value { font-family: Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums lining-nums; font-weight: 700; fill: #1c2127; }
                .sk-col-label { font-family: Inter, system-ui, sans-serif; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; fill: #767f8c; }
            `;
        const PRO_FONT_STACK = "'Segoe UI', Selawik, Helvetica, Arial, sans-serif";
        const PRO_TOKEN_VALUES = {
            '--sk-canvas': '#F7F8FA',
            '--sk-neutral-ribbon': '#8DA0B3',
            '--sk-neutral-node': '#44546A',
            '--sk-accent-profit': '#2A7A6B',
            '--sk-accent-cost': '#C24E00',
            '--sk-ink': '#1F2933',
            '--sk-ink-muted': '#5B6770'
        };
        function resolveProTokens(str) {
            return str.replace(/var\((--[a-z-]+)\)/g, (m, token) => PRO_TOKEN_VALUES[token] || m);
        }
        const PRO_EXPORT_STYLE_CSS = `
                .sk-leader { stroke: #C5CDD4; stroke-width: 1px; }
                .sk-label-pill { fill: #F7F8FA; }
                .sk-label-name, .sk-label-value, .sk-col-label {
                    paint-order: stroke fill;
                    stroke: #F7F8FA;
                    stroke-width: 3px;
                    stroke-linejoin: round;
                }
                .sk-label-name { font-family: ${PRO_FONT_STACK}; font-weight: 600; fill: #1F2933; letter-spacing: -0.01em; }
                .sk-label-value { font-family: ${PRO_FONT_STACK}; font-variant-numeric: tabular-nums lining-nums; font-weight: 400; fill: #5B6770; }
                .sk-col-label { font-family: ${PRO_FONT_STACK}; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; fill: #6B7280; }
                .sk-title { font-family: ${PRO_FONT_STACK}; font-weight: 600; fill: #1F2933; letter-spacing: -0.015em; }
                .sk-caption { font-family: ${PRO_FONT_STACK}; font-weight: 400; fill: #6B7280; }
            `;

        // ---- Deterministic text measurement for Node (no canvas) ----
        // Advance widths of Inter (variable font instanced at opsz 14, wght 600 and 700),
        // generated by scripts/gen-inter-metrics.py. No kerning, so widths can differ from
        // a browser canvas by a fraction of a pixel per label; the layout rules are unchanged.
        const INTER_UPM = 2048;
        const INTER_CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~£€¥–—…‘’“”•·×÷°%éèêëàâäôöûüçñßÉÀ→";
        const INTER_W600 = [516, 658, 1071, 1318, 1332, 2057, 1357, 667, 764, 764, 1105, 1378, 653, 953, 653, 776, 1351, 866, 1276, 1303, 1364, 1254, 1310, 1180, 1311, 1310, 653, 674, 1378, 1378, 1378, 1113, 2046, 1490, 1350, 1509, 1479, 1240, 1204, 1534, 1527, 567, 1187, 1440, 1158, 1889, 1555, 1574, 1321, 1583, 1336, 1332, 1352, 1507, 1490, 2089, 1474, 1461, 1336, 764, 776, 764, 986, 961, 719, 1176, 1278, 1193, 1278, 1211, 796, 1281, 1254, 536, 536, 1166, 536, 1844, 1253, 1247, 1278, 1278, 813, 1125, 723, 1254, 1202, 1719, 1165, 1205, 1159, 931, 735, 931, 1378, 1289, 1390, 1154, 1024, 2048, 1958, 602, 602, 1038, 1027, 1031, 653, 1378, 1378, 938, 2057, 1211, 1211, 1211, 1211, 1176, 1176, 1176, 1247, 1247, 1254, 1254, 1193, 1253, 1318, 1240, 1490, 1954];
        const INTER_W700 = [485, 692, 1129, 1329, 1341, 2080, 1376, 694, 772, 772, 1145, 1390, 684, 958, 684, 795, 1381, 883, 1289, 1322, 1385, 1274, 1330, 1191, 1333, 1330, 684, 702, 1390, 1390, 1390, 1146, 2081, 1529, 1355, 1515, 1479, 1244, 1202, 1537, 1530, 575, 1197, 1473, 1158, 1908, 1561, 1578, 1327, 1591, 1345, 1341, 1367, 1499, 1529, 2125, 1512, 1497, 1360, 772, 795, 772, 997, 975, 748, 1189, 1291, 1205, 1291, 1220, 815, 1294, 1275, 555, 555, 1188, 555, 1869, 1275, 1256, 1291, 1291, 834, 1147, 750, 1275, 1228, 1741, 1188, 1233, 1173, 960, 761, 960, 1390, 1308, 1402, 1168, 1024, 2048, 2052, 636, 636, 1106, 1089, 971, 684, 1390, 1390, 941, 2080, 1220, 1220, 1220, 1220, 1189, 1189, 1189, 1256, 1256, 1275, 1275, 1205, 1275, 1346, 1244, 1529, 1954];
        function createInterMeasurer() {
            const t600 = new Map(), t700 = new Map();
            Array.from(INTER_CHARS).forEach((ch, i) => { t600.set(ch, INTER_W600[i]); t700.set(ch, INTER_W700[i]); });
            const fallback600 = t600.get('n'), fallback700 = t700.get('n');
            return function measureTextWidth(text, font) {
                const m = /(\d+)\s+(\d+(?:\.\d+)?)px/.exec(font || '');
                const weight = m ? parseInt(m[1], 10) : 600;
                const size = m ? parseFloat(m[2]) : 12.5;
                const table = weight >= 700 ? t700 : t600;
                const fb = weight >= 700 ? fallback700 : fallback600;
                let units = 0;
                for (const ch of String(text)) units += table.has(ch) ? table.get(ch) : fb;
                return units * size / INTER_UPM;
            };
        }

        // Selawik (metric-compatible with Segoe UI) advance widths, used only by --style pro.
        // Static TTF instances at wght 400 / 600 / 700. Missing glyphs (e.g. →) fall back to 'n'.
        const SELAWIK_UPM = 2048;
        const SELAWIK_W400 = [561, 582, 803, 1210, 1104, 1676, 1639, 471, 618, 618, 854, 1401, 444, 819, 444, 798, 1104, 1104, 1104, 1104, 1104, 1104, 1104, 1104, 1104, 1104, 444, 444, 1401, 1401, 1401, 918, 1956, 1321, 1174, 1268, 1436, 1036, 1000, 1405, 1454, 545, 731, 1188, 964, 1839, 1532, 1544, 1147, 1544, 1225, 1088, 1073, 1407, 1272, 1913, 1208, 1132, 1168, 618, 776, 618, 1401, 850, 549, 1042, 1204, 946, 1206, 1071, 641, 1206, 1159, 496, 496, 1018, 496, 1764, 1159, 1200, 1206, 1206, 712, 869, 694, 1159, 981, 1480, 940, 991, 926, 618, 490, 618, 1401, 1104, 1104, 1104, 1024, 2048, 1501, 469, 469, 772, 772, 832, 444, 1401, 1401, 772, 1676, 1071, 1071, 1071, 1071, 1042, 1042, 1042, 1200, 1200, 1159, 1159, 946, 1159, 1114, 1036, 1321, 1159];
        const SELAWIK_W600 = [564, 641, 941, 1212, 1153, 1743, 1706, 557, 710, 710, 906, 1432, 518, 825, 518, 871, 1153, 1153, 1153, 1153, 1153, 1153, 1153, 1153, 1153, 1153, 518, 518, 1432, 1432, 1432, 904, 1955, 1400, 1267, 1275, 1485, 1072, 1043, 1439, 1531, 614, 852, 1282, 1019, 1920, 1589, 1550, 1221, 1550, 1300, 1128, 1158, 1456, 1335, 2010, 1297, 1206, 1218, 710, 854, 710, 1432, 850, 612, 1082, 1248, 971, 1247, 1096, 737, 1247, 1208, 553, 553, 1103, 553, 1839, 1212, 1235, 1248, 1247, 781, 890, 763, 1212, 1067, 1582, 1067, 1065, 963, 710, 609, 710, 1432, 1153, 1153, 1153, 1024, 2048, 1746, 552, 552, 931, 931, 854, 518, 1432, 1432, 776, 1743, 1096, 1096, 1096, 1096, 1082, 1082, 1082, 1234, 1233, 1212, 1212, 971, 1212, 1229, 1072, 1400, 1212];
        const SELAWIK_W700 = [565, 670, 1010, 1213, 1178, 1776, 1740, 600, 756, 756, 932, 1448, 555, 828, 555, 908, 1178, 1178, 1178, 1178, 1178, 1178, 1178, 1178, 1178, 1178, 555, 555, 1448, 1448, 1448, 897, 1954, 1440, 1313, 1278, 1510, 1090, 1065, 1456, 1569, 649, 912, 1329, 1047, 1960, 1618, 1553, 1258, 1553, 1337, 1148, 1200, 1481, 1366, 2058, 1342, 1243, 1243, 756, 893, 756, 1448, 850, 643, 1102, 1270, 983, 1268, 1108, 785, 1268, 1233, 582, 582, 1145, 582, 1876, 1239, 1252, 1270, 1268, 815, 901, 797, 1239, 1110, 1633, 1131, 1102, 981, 756, 668, 756, 1448, 1178, 1178, 1178, 1024, 2048, 1868, 594, 594, 1010, 1010, 865, 555, 1448, 1448, 778, 1776, 1108, 1108, 1108, 1108, 1102, 1102, 1102, 1251, 1250, 1239, 1239, 983, 1239, 1286, 1090, 1440, 1239];
        function createSelawikMeasurer() {
            const t400 = new Map(), t600 = new Map(), t700 = new Map();
            Array.from(INTER_CHARS).forEach((ch, i) => {
                t400.set(ch, SELAWIK_W400[i]); t600.set(ch, SELAWIK_W600[i]); t700.set(ch, SELAWIK_W700[i]);
            });
            const fb400 = t400.get('n'), fb600 = t600.get('n'), fb700 = t700.get('n');
            return function measureTextWidth(text, font) {
                const m = /(\d+)\s+(\d+(?:\.\d+)?)px/.exec(font || '');
                const weight = m ? parseInt(m[1], 10) : 600;
                const size = m ? parseFloat(m[2]) : 13;
                const table = weight >= 700 ? t700 : weight >= 600 ? t600 : t400;
                const fb = weight >= 700 ? fb700 : weight >= 600 ? fb600 : fb400;
                let units = 0;
                for (const ch of String(text)) units += table.has(ch) ? table.get(ch) : fb;
                return units * size / SELAWIK_UPM;
            };
        }

        // Pro ribbon fill: auto colours last-column inflows and pooling-node outflows
        // by the target, everything else by the source. Ink / dark slate are skipped
        // in favour of the other end, or a light neutral.
        const PRO_RIBBON_FALLBACK = '#A7B1BC';
        function concreteCssColor(color) {
            if (!color) return PRO_RIBBON_FALLBACK;
            let hex = color.charAt(0) === '#' ? color : resolveProTokens(String(color));
            if (hex.charAt(0) !== '#') return PRO_RIBBON_FALLBACK;
            return hex.toUpperCase();
        }
        function hexLumAndSat(hex) {
            const h = hex.replace('#', '');
            if (h.length !== 6) return { lum: 0, sat: 0 };
            const r = parseInt(h.slice(0, 2), 16) / 255;
            const g = parseInt(h.slice(2, 4), 16) / 255;
            const b = parseInt(h.slice(4, 6), 16) / 255;
            const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : (max - min) / max;
            return { lum, sat };
        }
        function isDarkRibbonFill(color) {
            const hex = concreteCssColor(color).toUpperCase();
            if (hex === '#1F2933' || hex === '#1C2127' || hex === '#44546A') return true;
            const { lum, sat } = hexLumAndSat(hex);
            // Dark, low-chroma greys and slates (including shades of ink/slate).
            return lum < 0.14 && sat < 0.42;
        }
        function pickProRibbonFill(srcColor, tgtColor, mode, sRank, tRank, numCols, srcIsPool) {
            const src = concreteCssColor(srcColor);
            const tgt = concreteCssColor(tgtColor);
            let preferTarget = mode === 'target';
            if (mode === 'auto') {
                preferTarget = (tRank === numCols - 1) || (sRank > 0 && sRank < numCols - 1) || !!srcIsPool;
            }
            const first = preferTarget ? tgt : src;
            const other = preferTarget ? src : tgt;
            if (!isDarkRibbonFill(first)) return first;
            if (!isDarkRibbonFill(other)) return other;
            return PRO_RIBBON_FALLBACK;
        }

        // Push labels apart vertically so they do not overlap, then clamp to [minY, maxY].
        // Used only by --style pro. items: [{midY, blockH}, ...]; returns a midY per item.
        function spreadLabelMids(items, minY, maxY, gap) {
            const n = items.length;
            if (!n) return [];
            const order = items.map((_, i) => i).sort((a, b) => items[a].midY - items[b].midY);
            const tops = order.map(i => items[i].midY - items[i].blockH / 2);
            for (let k = 1; k < n; k++) {
                const minTop = tops[k - 1] + items[order[k - 1]].blockH + gap;
                if (tops[k] < minTop) tops[k] = minTop;
            }
            const overflow = (tops[n - 1] + items[order[n - 1]].blockH) - maxY;
            if (overflow > 0) {
                for (let k = 0; k < n; k++) tops[k] -= overflow;
            }
            if (tops[0] < minY) {
                tops[0] = minY;
                for (let k = 1; k < n; k++) {
                    tops[k] = Math.max(tops[k], tops[k - 1] + items[order[k - 1]].blockH + gap);
                }
            }
            const out = new Array(n);
            for (let k = 0; k < n; k++) out[order[k]] = tops[k] + items[order[k]].blockH / 2;
            return out;
        }

        // ---- Version-2 data normalisation (mirrors the page's applyImportedSankeyData v2 path) ----
        // nodes[] is rebuilt from the names used by links, in first-use order; colour comes
        // from the file; displayName (when different from name) becomes the label; value and
        // column overrides are copied. Nodes that no link uses are dropped, as in the page.
        function normalizeV2(data) {
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Input is not a JSON object.');
            if (data.version !== 2) {
                if (data.version === 3) throw new Error('Version 3 (series) files are not supported by the CLI; load them in index.html.');
                throw new Error('This data file is from an older, incompatible version. Please re-create it in the current version.');
            }
            if (!data.nodes || !data.links) throw new Error('Missing structural arrays');
            if (!Array.isArray(data.nodes) || !Array.isArray(data.links)) throw new Error("'nodes' and 'links' must be arrays.");
            const colorRefShapeOk = data.nodes.every(n => !n.color || (typeof n.color === 'object' && typeof n.color.themeIndex === 'number'));
            if (!colorRefShapeOk) throw new Error("This data file's node colors aren't in the expected theme-reference format.");
            const overridesOk = data.nodes.every(n =>
                (n.value === undefined || (typeof n.value === 'number' && n.value >= 0)) &&
                (n.column === undefined || (typeof n.column === 'number' && Number.isInteger(n.column) && n.column >= 0)) &&
                (n.order === undefined || (typeof n.order === 'number' && Number.isFinite(n.order))) &&
                (n.displayName === undefined || typeof n.displayName === 'string')
            );
            if (!overridesOk) throw new Error("One or more nodes has an invalid 'value', 'column' or 'order' field.");
            if (data.columnLabels !== undefined && (!Array.isArray(data.columnLabels) || !data.columnLabels.every(l => l === null || typeof l === 'string')))
                throw new Error("'columnLabels' must be an array of strings.");
            const registry = {}, labels = {};
            data.nodes.forEach(n => {
                registry[n.name] = { color: n.color };
                if (n.displayName && n.displayName !== n.name) labels[n.name] = n.displayName;
            });
            const links = data.links;
            const usedNames = new Set();
            links.forEach(l => { if (l.source) usedNames.add(l.source); if (l.target) usedNames.add(l.target); });
            const nodes = [];
            usedNames.forEach(name => {
                if (!registry[name]) registry[name] = { color: { themeIndex: 0, variant: 'base' } };
                const n = { name, color: registry[name].color };
                if (labels[name] !== undefined) n.label = labels[name];
                nodes.push(n);
            });
            data.nodes.forEach(src => {
                const dest = nodes.find(n => n.name === src.name);
                if (!dest) return;
                if (typeof src.value === 'number') dest.value = src.value;
                if (typeof src.column === 'number') dest.column = src.column;
                if (typeof src.order === 'number') dest.order = src.order;
            });
            const columnLabels = Array.isArray(data.columnLabels) ? data.columnLabels : [];
            return { nodes, links, columnLabels };
        }

        // Recolour each .sk-ribbon path by its route end. If the target name is in
        // colorMap, use that colour; otherwise the source; otherwise leave the fill.
        // Same rule as the job-local post-process; opt-in, default output unchanged.
        function recolorRibbonsByRoute(svg, colorMap) {
            if (!colorMap || typeof colorMap !== 'object') return svg;
            const names = Object.keys(colorMap);
            if (!names.length) return svg;
            return String(svg).replace(/<path\b[^>]*class="sk-ribbon"[^>]*>/g, (tag) => {
                const srcM = tag.match(/data-source="([^"]*)"/);
                const tgtM = tag.match(/data-target="([^"]*)"/);
                if (!srcM || !tgtM) return tag;
                const color = colorMap[tgtM[1]] || colorMap[srcM[1]];
                if (!color) return tag;
                if (/\bfill="/.test(tag)) return tag.replace(/\bfill="[^"]*"/, `fill="${color}"`);
                return tag.replace(/\s*\/?>$/, (end) => ` fill="${color}"${end}`);
            });
        }

        // Standalone SVG, equivalent to the page's "Export SVG" (transparent background,
        // var(--sk-*) tokens resolved, stylesheet inlined, <desc> summary). Pure string build.
        // options: paletteMode, ribbonStyle, diagramAspect, showValues, showPassThrough,
        // globalOpacityValue, themePalette, width (container width), background (bool),
        // measureTextWidth, locale, plotHeight, wordGapEm, routeColors.
        function renderStandaloneSvg(data, options) {
            options = options || {};
            const norm = normalizeV2(data);
            const locale = options.locale !== undefined ? options.locale : 'en-US';
            const res = renderDiagramBody({
                nodes: norm.nodes, links: norm.links, columnLabels: norm.columnLabels,
                paletteMode: options.paletteMode, ribbonStyle: options.ribbonStyle,
                diagramAspect: options.diagramAspect, showValues: options.showValues,
                showPassThrough: options.showPassThrough, globalOpacityValue: options.globalOpacityValue,
                themePalette: options.themePalette || (options.paletteMode === 'house' ? HOUSE_THEME_PALETTE : undefined),
                title: options.title, caption: options.caption,
                ribbonColorMode: options.ribbonColorMode,
                plotHeight: options.plotHeight,
                wordGapEm: options.wordGapEm,
            }, { measureTextWidth: options.measureTextWidth || (options.ribbonStyle === 'pro' ? createSelawikMeasurer() : createInterMeasurer()), containerW: options.width || 900, locale });
            if (res.status === 'empty') throw new Error('Nothing to render: the file has no nodes or no links.');
            if (res.status === 'no-valid-flows') throw new Error('No valid flows to render: every link must join two named nodes with a value above 0.');
            let body = res.body;
            const bg = /^<rect class="sk-canvas-bg"[^>]*\/>/;
            const isPro = options.ribbonStyle === 'pro';
            const resolve = isPro ? resolveProTokens : resolveTokens;
            const exportCss = isPro ? PRO_EXPORT_STYLE_CSS : EXPORT_STYLE_CSS;
            body = options.background ? body.replace(bg, m => resolve(m)) : body.replace(bg, '');
            body = body.replace(/ (fill|stroke)="([^"]*var\([^"]*)"/g, (m, attr, val) => ` ${attr}="${resolve(val)}"`);
            // A raw newline inside an attribute is read as a space by XML parsers; the page's
            // XMLSerializer writes it as &#xA;. Do the same so CLI output matches app exports.
            body = body.replace(/ d="([^"]*)"/g, (m, val) => ` d="${val.replace(/\n/g, '&#xA;')}"`);
            const desc = escapeHtml(accessibleSummaryText(res.validLinks, locale));
            const sizeAttrs = isPro ? ` width="${res.W}" height="${res.H}"` : '';
            const styleAttr = isPro ? ' style="display:block;"' : ' style="width:100%; height:auto; display:block;"';
            let out = `<svg xmlns="http://www.w3.org/2000/svg" id="sankey-svg"${sizeAttrs} viewBox="0 0 ${res.W} ${res.H}"${styleAttr} role="img" aria-labelledby="sankey-a11y-summary">`
                + `<style>${exportCss}</style><desc id="sankey-a11y-summary">${desc}</desc>${body}</svg>\n`;
            if (options.routeColors) out = recolorRibbonsByRoute(out, options.routeColors);
            return out;
        }

        return {
            DEFAULT_THEME_PALETTE, HOUSE_THEME_PALETTE, THEME_TINT_PERCENTS, THEME_SHADE_PERCENTS,
            mixToward, deriveVariant, resolveThemeColor,
            computePassThroughGraph, assignColumnsRaw, assignColumns, layoutColumn,
            semanticRole, resolveNodeColor, resolveRibbonColor, formatFlowValue,
            escapeHtml, escapeAttr, renderDiagramBody, accessibleSummaryText,
            SK_TOKEN_VALUES, resolveTokens, EXPORT_STYLE_CSS,
            PRO_TOKEN_VALUES, resolveProTokens, PRO_EXPORT_STYLE_CSS, PRO_FONT_STACK,
            createInterMeasurer, createSelawikMeasurer, spreadLabelMids, pickProRibbonFill, isDarkRibbonFill,
            normalizeV2, renderStandaloneSvg, recolorRibbonsByRoute,
        };
});
