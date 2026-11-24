# Report round 1 — implementatore

## Fatto

- Scaffold: `package.json` (nessuna dipendenza), `index.html`, `src/styles.css`, `src/main.js`, `README.md`.
- `scripts/build.mjs`: concatenazione topologica dei moduli raggiungibili da `src/main.js`, CSS inline, errori chiari (export default, import non supportati, nomi top-level duplicati, import di nomi non esportati, cicli, moduli mancanti). `dist/index.html` = 53265 byte (52 KB), 12 moduli.
- Moduli puri con test: `html-text`, `mht` (binary/8bit/QP/base64, header ripiegati, boundary con/senza virgolette, RFC 2047), `chord`, `model`, `parser` (metodo spans e fallback testo, rimozione pubblicità annidata, annotazioni `*`), più `segments` (algoritmo a segmenti).
- Fixture sintetiche (5 varianti + `EXPECTED.md`) generate da `make-fixtures.mjs`, con testo inventato e tutte le insidie del file reale.
- `storage.js` (libreria su localStorage con storage iniettabile, errore di quota leggibile).
- UI: libreria (import, elenco, eliminazione con conferma, stato vuoto con istruzioni), vista brano (intestazione, chip colorati, sezioni, accordi sopra il testo, `*` piccolo accanto all'accordo, ripetizioni comprimibili, A−/A+, tema, foglio accordo con aggancio `onChordTap(ref, name)`, BPM mancante con campo, avvisi di importazione), routing con `location.hash`.

## Test

66 test, 66 verdi, 0 saltati (`npm test`). Il test sul file reale gira (file presente). Copre: criteri M1 (titolo, artista, difficoltà, accordatura, capo, 12 sezioni, 328 accordi, `G D Em Am C A`, 3 ritmi 62/96/142, `bpm` 62), assenza pubblicità, 22 righe con `*`.

## Verifica con Playwright (dist/index.html, Pixel 7 con viewport 360 px, file reale)

- Import via `setInputFiles`: 12 sezioni, 328 etichette accordo, nessun errore in console.
- `scrollWidth == clientWidth == 360` a scala 1.0 e 2.0: nessuno scroll orizzontale.
- Nessuna sovrapposizione tra etichette accordo visibili (controllo sui rettangoli).
- Screenshot guardati (`test-artifacts/`, non versionati): testo leggibile senza zoom, accordi allineati alle sillabe anche con righe a capo, tema scuro e chiaro, foglio accordo, libreria vuota. Un primo giro mostrava spazi dentro le parole sotto accordi a metà parola ("tim e"): corretto togliendo il padding del testo e riducendo il `min-width`.
- Verificati anche: A−/A+ e tema persistono dopo reload, toggle ripetizioni, eliminazione con conferma, BPM mancante (fixture `song-nostrum`) con salvataggio, errore di import leggibile su file senza HTML.

## Non verificato / limiti

- Nessuna prova su telefono reale, né Safari/iOS (l'`accept` dell'input file va provato lì; ripiego nelle decisioni).
- Con un accordo sopra una parola più corta dell'etichetta, o a metà parola, resta uno spazio dopo la parola (previsto dal piano).
- Il diagramma nel foglio accordo non esiste (round 3). Nessun player/metronomo (round 2).
- `dist/index.html` non testato da un server statico, solo via `file://`.

## Decisioni

Tutte in `docs/DECISIONS.md` (sezione Round 1). Le principali: `npm test` con glob (`node --test test/` non funziona su Node 22: CLAUDE.md da aggiornare); "22 accordi con `*`" letto come 22 righe (38 accordi); h1 preferito al Subject; righe vuote non salvate; ripetizioni fuse/compresse per contenuto; tema iniziale da `prefers-color-scheme`.
