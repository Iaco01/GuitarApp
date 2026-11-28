# Round 14 — Report dell'implementatore

Brani in tablatura: import da PDF, modello, vista con cursore, accordi dalla tab, chitarra synth, capo. Decisioni in `docs/DECISIONS.md` («Round 14»).

## Cosa c'è
- `src/pdf.js` (puro): lettura del PDF senza dipendenze (xref tabella/stream, ObjStm, Flate con `DecompressionStream`, ToUnicode, Type0/Identity-H, righe e colonne; banner sovrapposti separati).
- `src/tab.js`, `src/tabplay.js`, `src/tablayout.js`, `src/tabsynth.js`, `src/capo.js` (puri), `src/synthvoice.js` (Web Audio), `src/ui/tabview.js`; ritocchi a `model.js` (schema 4, `kind`), `player.js` (scheduler delle note), `playpanel.js` (controlli della chitarra), `library.js`/`main.js` (import PDF, `.txt`, «Incolla una tab»), `libio.js`, `storage.js`, `parser.js` (capo).
- Test: `pdf`, `tab`, `tablayout`, `tabsynth`, `tab-real` (si salta senza il PDF), e2e `test/e2e/round14.cjs` (320, SE, 13, 13 orizzontale) con `round14-make.mjs`.

## Cosa si legge del PDF reale (solo conteggi)
- 6 pagine, 315 righe di testo, 0 avvisi; 72 righe di tab con etichetta (12 sistemi da 6 corde: 9 nella tab, 3 nei commenti, che si ignorano da «VERSIONS» in poi). MarkItDown ne vede 71: sotto un banner ne perde una.
- 2 parti (Chitarra 1, Chitarra 2); sezioni: parte 1 = 2 (la prima con due nomi), parte 2 = 2 (la prima con due nomi).
- 9 battute (4+1 e 2+2): una per sistema, senza stanghette interne (ogni battuta ha 41+13 caratteri, 4 battiti); 125 colonne con note, 381 note; tecniche presenti: solo `/`.
- Accordi: solo nella parte 1, 8 nomi scritti, 5 voci diverse (F#m7, A, D, E, C#m), tutte disegnabili dalla tab (barré dal 7° al 12° tasto, dita assegnate). Il riff (parte 2) non ha nomi.
- Accordatura Standard, **capo 0**: nel testo non c'è la parola «capo» né glifi non decodificati (0 caratteri di sostituzione).
- Non si legge / limiti: i glifi di tipo Type3 (icone, stelle) sono ignorati; BPM e ripetizioni non ci sono (100 BPM predefiniti, ordine = quello della tab); la tab non dice il ritmo, quindi 4 battiti per battuta con le note distribuite in proporzione agli spazi.

## Come funziona la vista
Monospazio che si ridispone alla larghezza; battute lunghe tagliate con le etichette ripetute; nomi di accordo sopra la colonna giusta (verificato in e2e); cursore a colonna + battuta evidenziata, il foglio segue; selettore parti; diagrammi di lato dalla voce della tab; legenda dei simboli toccabile; ordine delle sezioni modificabile; capo in cima.

## E2E (Playwright, Chromium)
Vedi l'ultima sezione: risultati per profilo. Screenshot in `test-artifacts/round-14/` (non versionati).

Risultati (`node test/e2e/round14-make.mjs && node scripts/build.mjs && node test/e2e/round14.cjs <320|SE|13|13L>`): **ALL PASS su 320, SE, 13 e 13 orizzontale** (ultimo giro: 320 e 13L dopo una correzione dell'e2e, SE e 13 col resto invariato). Controlli: import del PDF sintetico, del testo incollato e del PDF reale (conteggi), nessuno scorrimento orizzontale (anche con testo più grande e con «Tutte»), nomi di accordo sulla colonna con note, diagrammi dalle voci (F#m7: tasto 9, barré, dita 1-3-2), selettore parti, cursore e battuta evidenziata, ordine battute, ordine delle sezioni, loop, velocità 50% (battuta lunga il doppio), legenda; chitarra synth: una nota per ogni nota della tab, tempi uguali al piano (0,0 ms di scarto), nessuna nota in ritardo, buffer intonati entro 10 cent, capo che alza di 200 cent, 50% stesse altezze e tempi doppi, pausa senza note, ripresa, salto su una battuta, volume, solo tic, loop che ripete le note della sezione.
`npm test`: 336 verdi.

## Chitarra synth e capo (aggiunte dell'utente)
Vedi DECISIONS («Capotasto», «Chitarra synth»). Per un brano tab senza audio, Play suona la chitarra (Karplus-Strong in `AudioBuffer`, senza AudioWorklet), col metronomo facoltativo e spento; volume e on/off nel menu ⋯ del pannello e nel foglio «Ordine, simboli e impostazioni». Stesso orologio e stesso scheduler dei tic (`createNoteScheduler`). Il capo nel PDF reale non c'è (0).
Non fatto: synth + mp3, volume per parte, tap tempo per le tab (il pulsante c'è ma non fa nulla).
