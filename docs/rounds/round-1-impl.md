# Round 1 — Implementatore: fondamenta, parser, visualizzazione (M1 + M2)

Leggi prima `CLAUDE.md`, `docs/SPEC.md` e `docs/IMPLEMENTATION_PLAN.md` (contratti e dettagli del file reale). Questo file dice cosa fare in questo round e quando è finito.

## Compiti, in ordine

1. **Scaffold**
   - `package.json` con `"type": "module"`, `"private": true`, script `test` (`node --test test/`), `build` (`node scripts/build.mjs`), `fixtures` (`node test/fixtures/make-fixtures.mjs`). Nessuna dipendenza.
   - `index.html` (shell di sviluppo), `src/styles.css`, `src/main.js`.
   - `README.md` breve in italiano: cos'è, come si fa la build, come si aprono i test, come salvare una pagina UG da Chrome Android / Safari iOS (in Chrome: menu ⋮ → Scarica / "Salva pagina" come MHTML su desktop; annota che su mobile il salvataggio MHTML può non essere disponibile e che il modo sicuro oggi è salvare da Chrome desktop e passare il file al telefono).

2. **`scripts/build.mjs`** come da piano (concatenazione topologica, controllo nomi duplicati, CSS inline). Fallisce con messaggio chiaro se una convenzione è violata (es. `export default`).

3. **`src/html-text.js`, `src/mht.js`, `src/chord.js`** con i test (`test/mht.test.js`, `test/chord.test.js`).

4. **Fixture sintetiche**: `test/fixtures/make-fixtures.mjs` → `test/fixtures/synthetic/*.mht` + `EXPECTED.md`, tutte le varianti del piano, con le insidie del file reale (pubblicità annidata nel `<pre>`, `*`, righe di soli spazi, boundary ripiegato, tre ritmi con BPM diversi). Testo inventato in italiano (es. strofe di fantasia), mai frasi di canzoni reali.

5. **`src/parser.js` + `src/model.js`** con `test/parser.test.js` (fixture sintetiche, tutte le varianti) e `test/real-fixture.test.js` (file reale, con skip se assente). Tutti i valori di `EXPECTED.md` e tutti i criteri del file reale elencati nel piano devono passare.

6. **`src/storage.js`** (solo libreria localStorage in questo round) con test che usano uno storage finto in memoria.

7. **UI**: libreria + import + vista brano, come da sezione "Visualizzazione" del piano.
   - Import: `<input type="file" accept=".mht,.mhtml,.html,message/rfc822,multipart/related">` (su iOS l'`accept` troppo stretto rende il file non selezionabile: verifica e, se serve, documenta in DECISIONS una lista più larga). Dopo l'import si apre il brano.
   - Se `bpm` è `null` la UI mostra "BPM non trovato" e un campo per inserirlo (salvato nel brano).
   - Eliminazione brano dalla libreria con conferma.
   - Vista brano: intestazione, chip accordi colorati, sezioni, accordi sopra il testo con l'algoritmo a segmenti, `mark` (`*`) mostrato piccolo accanto all'accordo, ripetizioni comprimibili, A−/A+, tema chiaro/scuro, tocco accordo → foglio con il nome (aggancio per il round 3).
   - Nessuno scroll orizzontale a 360 px; nessuna sovrapposizione tra etichette accordo.

8. **Build e verifica manuale**: `npm test` verde, `npm run build` produce `dist/index.html`. Apri `dist/index.html` con Playwright (Chromium già installato: `require('playwright')` funziona; usa un file `.cjs` nello scratch, non aggiungere dipendenze), emulazione telefono (es. `devices['Pixel 7']`), importa il file reale tramite `setInputFiles`, fai uno screenshot e guardalo per controllare che la pagina sia leggibile. Gli screenshot vanno in `test-artifacts/` (ignorato da git).

## Fuori da questo round

Player, metronomo, durate modificabili, trasposizione, diagrammi, export/import JSON, audio. Non implementarli: lascia solo i punti di aggancio indicati.

## Consegna

- Commit piccoli e leggibili su `main` (messaggi in inglese, imperativo). Non fare push: lo fa il coordinatore.
- Scrivi `docs/reports/round-1-impl.md`: cosa hai fatto, scelte prese (riportale anche in `docs/DECISIONS.md`), cosa non funziona o non hai potuto verificare, numero di test e loro esito, dimensione di `dist/index.html`.
- Nella risposta finale riassumi in 10–15 righe lo stesso contenuto.
