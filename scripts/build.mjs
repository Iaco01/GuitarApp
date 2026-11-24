// Zero-dependency build: concatenates the ES modules reachable from src/main.js (topological
// order) into one <script type="module"> and inlines the CSS, producing dist/index.html.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*(['"])(\.{1,2}\/[^'"]+)\2\s*;?\s*$/;
const EXPORT_OK_RE = /^export\s+(?:async\s+function\*?|function\*?|const|class)\s+([A-Za-z_$][\w$]*)/;
const TOP_DECL_RE = /^(?:export\s+)?(?:async\s+function\*?|function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

function fail(msg) {
  throw new Error('Build fallita: ' + msg);
}

function analyse(file, text) {
  const imports = []; // { names, spec }
  const exports = [];
  const declared = [];
  const out = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    if (/^\s*import\b/.test(line) && !/^\s*import\s*\(/.test(line)) {
      const m = IMPORT_RE.exec(line);
      if (!m) fail(`${where}: import non supportato (ammesso solo "import { a } from './x.js';" su una riga): ${line.trim()}`);
      imports.push({ names: m[1].split(',').map((s) => s.trim()).filter(Boolean), spec: m[3], where });
      out.push('');
      return;
    }
    if (/\bimport\s*\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) fail(`${where}: import dinamico non supportato`);
    if (/^\s*export\b/.test(line)) {
      if (/^export\s+default\b/.test(line)) fail(`${where}: "export default" non supportato`);
      const m = EXPORT_OK_RE.exec(line);
      if (!m) fail(`${where}: export non supportato (solo "export function|const|class"): ${line.trim()}`);
      exports.push(m[1]);
    }
    if (/^(?:export\s+)?(?:const|let|var)\s*[[{]/.test(line)) fail(`${where}: destrutturazione al livello principale non supportata`);
    const d = TOP_DECL_RE.exec(line);
    if (d) declared.push({ name: d[1], where });
    out.push(line.replace(/^export\s+/, ''));
  });
  return { imports, exports, declared, code: out.join('\n') };
}

export function buildProject({ root, outFile } = {}) {
  const base = resolve(root || join(dirname(fileURLToPath(import.meta.url)), '..'));
  const srcDir = join(base, 'src');
  const entry = 'main.js';
  const mods = new Map();

  function load(rel, from) {
    const key = posix.normalize(rel);
    if (mods.has(key)) return mods.get(key);
    const path = join(srcDir, key);
    if (!existsSync(path)) fail(`${from || 'entry'}: modulo non trovato: src/${key}`);
    const info = analyse('src/' + key, readFileSync(path, 'utf-8'));
    const mod = { key, ...info, state: 'new', deps: [] };
    mods.set(key, mod);
    for (const imp of info.imports) {
      const depKey = posix.normalize(posix.join(posix.dirname(key), imp.spec));
      mod.deps.push({ key: depKey, imp });
      load(depKey, 'src/' + key);
    }
    return mod;
  }
  load(entry);

  // Imported names must be exported by the target.
  for (const mod of mods.values()) {
    for (const { key, imp } of mod.deps) {
      const target = mods.get(key);
      for (const n of imp.names) {
        if (!target.exports.includes(n)) fail(`${imp.where}: "${n}" non è esportato da src/${key}`);
      }
    }
  }

  // Topological order (dependencies first), with cycle detection.
  const order = [];
  function visit(mod, stack) {
    if (mod.state === 'done') return;
    if (mod.state === 'visiting') fail('dipendenza circolare: ' + [...stack, mod.key].join(' -> '));
    mod.state = 'visiting';
    for (const { key } of mod.deps) visit(mods.get(key), [...stack, mod.key]);
    mod.state = 'done';
    order.push(mod);
  }
  visit(mods.get(entry), []);

  // Unique top-level names across all modules.
  const owner = new Map();
  for (const mod of order) {
    for (const { name, where } of mod.declared) {
      if (owner.has(name)) fail(`nome top-level duplicato "${name}": ${owner.get(name)} e ${where}`);
      owner.set(name, where);
    }
  }

  const js = order.map((m) => `// ---- src/${m.key}\n${m.code}`).join('\n').replace(/<\/script/gi, '<\\/script');
  const cssPath = join(srcDir, 'styles.css');
  const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf-8').replace(/<\/style/gi, '<\\/style') : '';

  let html = readFileSync(join(base, 'index.html'), 'utf-8');
  const linkRe = /<link\b[^>]*href=["']src\/styles\.css["'][^>]*>/i;
  const scriptRe = /<script\b[^>]*src=["']src\/main\.js["'][^>]*>\s*<\/script>/i;
  if (!linkRe.test(html)) fail('index.html non contiene <link href="src/styles.css">');
  if (!scriptRe.test(html)) fail('index.html non contiene <script src="src/main.js">');
  html = html.replace(linkRe, () => `<style>\n${css}\n</style>`).replace(scriptRe, () => `<script type="module">\n${js}\n</script>`);

  const out = outFile ? resolve(outFile) : join(base, 'dist', 'index.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, 'utf-8');
  return { outFile: out, bytes: Buffer.byteLength(html, 'utf-8'), modules: order.map((m) => m.key) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const r = buildProject();
    console.log(`dist/index.html: ${r.bytes} byte (${(r.bytes / 1024).toFixed(1)} KB), ${r.modules.length} moduli`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
