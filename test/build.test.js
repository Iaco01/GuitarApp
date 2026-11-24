import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProject } from '../scripts/build.mjs';

const INDEX = '<!doctype html><html><head><link rel="stylesheet" href="src/styles.css"></head><body><script type="module" src="src/main.js"></script></body></html>';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'gapp-build-'));
  mkdirSync(join(root, 'src', 'ui'), { recursive: true });
  writeFileSync(join(root, 'index.html'), INDEX);
  writeFileSync(join(root, 'src', 'styles.css'), 'body{color:red}');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'src', name), text);
  return root;
}

test('concatenates modules in dependency order and inlines css', () => {
  const root = project({
    'main.js': "import { b } from './b.js';\nimport { c } from './ui/c.js';\nconsole.log(b(), c());\n",
    'b.js': "import { a } from './a.js';\nexport function b() { return a + 1; }\n",
    'a.js': 'export const a = 1;\n',
    'ui/c.js': "import { a } from '../a.js';\nexport const c = () => a;\n",
    'unused.js': 'export const unused = 1;\n',
  });
  try {
    const r = buildProject({ root });
    assert.deepEqual(r.modules, ['a.js', 'b.js', 'ui/c.js', 'main.js']);
    const html = readFileSync(r.outFile, 'utf-8');
    assert.ok(html.includes('<style>\nbody{color:red}'));
    assert.ok(!/\bimport\b.*from/.test(html));
    assert.ok(!/^export /m.test(html));
    assert.ok(html.indexOf('const a = 1') < html.indexOf('function b()'));
    assert.ok(!html.includes('unused'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const BAD = {
  'export default': { 'main.js': 'export default function f() {}\n' },
  'import *': { 'main.js': "import * as x from './a.js';\n", 'a.js': 'export const a = 1;\n' },
  'multi-line or unsupported import': { 'main.js': "import a from './a.js';\n", 'a.js': 'export const a = 1;\n' },
  're-export': { 'main.js': "export { a } from './a.js';\n", 'a.js': 'export const a = 1;\n' },
  'dynamic import': { 'main.js': "const m = import('./a.js');\n", 'a.js': 'export const a = 1;\n' },
  'duplicate top-level name': { 'main.js': "import { a } from './a.js';\nconst a2 = a;\nfunction helper() {}\n", 'a.js': 'export const a = 1;\nfunction helper() {}\n' },
  'unknown import': { 'main.js': "import { zzz } from './a.js';\n", 'a.js': 'export const a = 1;\n' },
  'missing module': { 'main.js': "import { a } from './nope.js';\n" },
  'cycle': { 'main.js': "import { a } from './a.js';\nexport const m = 1;\n", 'a.js': "import { m } from './main.js';\nexport const a = 1;\n" },
};
const MESSAGES = {
  'export default': /export default/,
  'import *': /import non supportato/,
  'multi-line or unsupported import': /import non supportato/,
  're-export': /export non supportato/,
  'dynamic import': /import dinamico/,
  'duplicate top-level name': /duplicato "helper"/,
  'unknown import': /non è esportato/,
  'missing module': /modulo non trovato/,
  'cycle': /circolare/,
};

for (const [label, files] of Object.entries(BAD)) {
  test(`build fails with a clear message: ${label}`, () => {
    const root = project(files);
    try {
      assert.throws(() => buildProject({ root }), (err) => err.message.startsWith('Build fallita:') && MESSAGES[label].test(err.message));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
