# GuitarApp — Accordi a tempo

Web app statica per telefono: importa una pagina Ultimate Guitar salvata (.mht), la mostra leggibile e la suona a tempo evidenziando l'accordo corrente.

- Specifica di prodotto: `docs/SPEC.md`. Piano tecnico e contratti tra moduli: `docs/IMPLEMENTATION_PLAN.md` (prevale sulla spec in caso di conflitto). Decisioni prese: `docs/DECISIONS.md`.
- Lavoro a round: compiti in `docs/rounds/round-N-impl.md` (implementatore) e `docs/rounds/round-N-test.md` (tester); report in `docs/reports/`.

## Regole

- Zero dipendenze npm (né runtime né dev). Solo moduli ES in `src/`, build con `node scripts/build.mjs` → `dist/index.html`.
- Convenzioni dei moduli (servono alla build): solo `import { a } from './x.js'` su una riga, solo `export function|const|class`, niente `export default`, niente `import *`, nomi top-level univoci tra tutti i moduli.
- I moduli puri (`html-text`, `mht`, `parser`, `chord`, `model`, `timeline`, `transpose`, `chords-db`, `diagram`, `libio`, `alignment`, `analysis/*`) non toccano DOM né `window`: devono girare in Node.
- Test: `npm test` (`node --test "test/*.test.js"`; `node --test test/` non funziona su Node 22). Deve restare verde a ogni commit.
- UI in italiano; codice, commenti e messaggi di commit in inglese.
- **Copyright**: `test/fixtures/local/` contiene una pagina reale con testo protetto. Mai copiarne il testo in file versionati, test, fixture sintetiche, report o screenshot committati. Le asserzioni sul file reale usano conteggi e nomi di sezione.
- Playwright e Chromium sono già installati nel container: `require('playwright')` da file `.cjs`, `chromium.launch()` senza opzioni. Non installare altro. Screenshot e artefatti in `test-artifacts/` (ignorato da git).
- Non fare push e non creare PR: lo fa il coordinatore.
- File allegati dall'utente in formati convertibili (PDF, Word, Excel, PowerPoint, HTML, immagini…): leggerli sempre con MarkItDown (`markitdown <file>`). Se nel container manca: `python3 -m pip install --user 'markitdown[all]'`. È uno strumento della sessione, non una dipendenza del progetto.
