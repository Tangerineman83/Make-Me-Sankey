// Shared test helpers (no dependencies).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(REPO, 'scripts', 'render-sankey.mjs');
export const tmp = () => mkdtempSync(path.join(tmpdir(), 'sankey-test-'));

export function runCli(args, env) {
    return spawnSync(process.execPath, [CLI, ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
}
export function renderToString(input, extra = [], env) {
    const out = path.join(tmp(), 'out.svg');
    const r = runCli([input, out, ...extra], env);
    if (r.status !== 0) throw new Error(`CLI exit ${r.status}: ${r.stderr}`);
    return readFileSync(out, 'utf8');
}

// Minimal strict XML well-formedness check: one root element, every tag closed in order,
// quoted attributes with no duplicates, only known/numeric entities, no stray '<' or '&'.
// Returns { root, elements } or throws with the reason.
export function parseXml(xml) {
    const stack = []; let root = null; let i = 0; let elements = 0;
    const ent = /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;
    const checkText = (t, where) => {
        for (let k = 0; k < t.length; k++) {
            if (t[k] === '<') throw new Error(`stray '<' in ${where}`);
            if (t[k] === '&' && !ent.test(t.slice(k))) throw new Error(`bad entity in ${where}: ${t.slice(k, k + 12)}`);
        }
    };
    while (i < xml.length) {
        const lt = xml.indexOf('<', i);
        const text = lt === -1 ? xml.slice(i) : xml.slice(i, lt);
        if (stack.length === 0 && text.trim()) throw new Error('text outside the root element');
        checkText(text, 'text');
        if (lt === -1) break;
        if (xml.startsWith('<?', lt)) { i = xml.indexOf('?>', lt) + 2; continue; }
        if (xml.startsWith('<!--', lt)) { i = xml.indexOf('-->', lt) + 3; continue; }
        const gt = xml.indexOf('>', lt);
        if (gt === -1) throw new Error('unterminated tag');
        let tag = xml.slice(lt + 1, gt);
        if (tag.startsWith('/')) {
            const name = tag.slice(1).trim();
            const open = stack.pop();
            if (open !== name) throw new Error(`closing </${name}> does not match <${open}>`);
        } else {
            const selfClose = tag.endsWith('/');
            if (selfClose) tag = tag.slice(0, -1);
            const m = /^([A-Za-z_][\w:.-]*)/.exec(tag);
            if (!m) throw new Error(`bad tag name near ${tag.slice(0, 20)}`);
            const name = m[1];
            let rest = tag.slice(name.length);
            const seen = new Set();
            const attr = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/;
            let am;
            while ((am = attr.exec(rest))) {
                if (seen.has(am[1])) throw new Error(`duplicate attribute ${am[1]} on <${name}>`);
                seen.add(am[1]);
                checkText(am[3] !== undefined ? am[3] : am[4], `attribute ${am[1]}`);
                rest = rest.slice(am[0].length);
            }
            if (rest.trim()) throw new Error(`malformed attributes on <${name}>: ${rest.slice(0, 30)}`);
            if (stack.length === 0) { if (root) throw new Error('more than one root element'); root = name; }
            elements++;
            if (!selfClose) stack.push(name);
        }
        i = gt + 1;
    }
    if (stack.length) throw new Error(`unclosed <${stack[stack.length - 1]}>`);
    if (!root) throw new Error('no root element');
    return { root, elements };
}

// Text content of every <text> element, entities decoded.
export function texts(svg) {
    return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => decode(m[1]));
}
export function titles(svg) {
    return [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map(m => decode(m[1]));
}
export function decode(s) {
    return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
