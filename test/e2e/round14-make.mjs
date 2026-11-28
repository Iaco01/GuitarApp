// Writes the synthetic tab PDFs used by round14.cjs to test-artifacts/round-14/ (invented content only).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { syntheticTabText, makeTabPdf } from '../fixtures/tab-fixtures.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-artifacts', 'round-14');
mkdirSync(out, { recursive: true });
const items = (text) => text.split('\n');
writeFileSync(join(out, 'synth.pdf'), await makeTabPdf(items(syntheticTabText({ wrap: 40, long: true })), { linesPerPage: 40 }));
writeFileSync(join(out, 'synth-text.txt'), syntheticTabText({ wrap: 0, long: true }));
console.log('written', out);
