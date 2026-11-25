# Report round 5 — implementatore (rifinitura)

Base: HEAD del round 4 (`6071c54`). Nessuna funzione nuova. `npm test`: **160/160** verdi (erano 154: i 3 test `todo` del tester sono ora normali e se ne sono aggiunti altri). `npm run build`: `dist/index.html` **246.648 byte** (240,9 KB), 30 moduli (erano 234.872, 29). Nessun testo del brano reale in file versionati: per il file reale solo conteggi e nomi di sezione. Gli screenshot sono in `test-artifacts/round-5/` (non versionati).

## Cosa è stato fatto, punto per punto

1. **BPM proporzionale (grave).** `suggestSectionBpms` calcola per ogni tratto (ancora → ancora, o ultima ancora → "Fine brano") `k = previsto / misurato`; `applyBpmSuggestion` moltiplica il BPM di ogni sezione del tratto per `k` (arrotondato a 0,1). Testo: «Tra Intro e Finale l'audio va il 0,5% più lento: da −0,7 a −0,4 BPM circa su ogni sezione.» Test sul file reale (`test/round5-fixes.test.js`): offset 3 s + "Fine brano" con durata dello 0,5% più corta → 62,3 / 96,5 / 142,7, errore a fine brano < 50 ms, nessun altro suggerimento dopo "Applica". Nel browser (traccia sintetica con il Finale a 97 invece di 96): 70/96/142/97 → 69,6/95,5/141,3/96,5, errore a fine brano 9 ms.
2. **Soglia sull'errore di tempo**: `|misurato − previsto| > max(150 ms, 0,3% del tratto)`. Ancora toccata 78 ms in ritardo: nessun suggerimento (test Node ed e2e `round5.cjs` R5).
3. **Tratti tra ancore senza vuoti né compressioni a metà**: in `buildTimeline` ogni tratto è scalato con un solo fattore. Timeline e eventi espongono `bpm` effettivo, `savedBpm`, `scale`; il pannello mostra «♩ ≈ 97,9» quando l'effettivo differisce dal salvato di più di 0,2. Test: riempimento esatto (sia comprimendo sia allungando), rapporti conservati, e una scansione a passi di 10 ms che non salta né torna indietro mai di un evento (Strofa a 92 e a 100). Sul browser: vuoto 0 ms, nessun accordo "bloccato".
4. **Ancore visibili**: le ⚓ compaiono nelle intestazioni appena si chiude la sincronizzazione e dopo un reload (la condizione non dipende più dallo stato di caricamento dell'audio). Tocco → foglio dal basso con ±10/±50 ms e "Togli l'ancora" (vista brano e schermata di sincronizzazione; sostituisce i ±0,1 s delle righe). `round4-tester-anchors.cjs` ora mostra la ⚓ dopo "Fatto" e dopo il reload.
5. **Libreria**: la lista si disegna subito con un badge neutro "audio", poi il controllo asincrono su IndexedDB lo porta a "audio ✓" o "audio mancante" (arancione). Verificato (R3: file cancellato da IndexedDB → "audio mancante").
6. **"Primo accordo!" con pausa iniziale**: `offset = tocco − startSec(primo evento non di pausa)` (`firstChordOffsetSec`). Con 4 battiti di pausa a 70 BPM, tocco a 4,0 s → offset 571 ms (atteso 571); tocco troppo presto → messaggio «Troppo presto…». Test Node ed e2e (R6).
7. **Prova da utente**:
   - schermata di sincronizzazione: barra fissa in basso con «Primo accordo!» e «⚓ Inizio: <sezione>» affiancati, alti 56 px, visibili appena caricato l'audio senza scorrere; sotto −5 s / Play / +5 s / posizione / «⋯» (scorrimento e «Ascolta dall'inizio (con il clic)» sono dietro «⋯»). Altezza della barra: **123 px su 667 (18,4%)** su iPhone SE 375×667, 215 px con «⋯» aperto;
   - i messaggi sono un foglio fisso sopra la barra: vanno a capo, non sono tagliati (verificato su SE e 13), spariscono dopo 5 s (9 s se errore);
   - pannello: «🔁 Strofa» (tocco = esci) e icona del clic 🔔/🔕 sempre visibili nella seconda riga, senza aprire «⋯»;
   - il foglio dell'ancora ha `z-index` sopra la schermata di sincronizzazione (altrimenti restava sotto).
   - Punti della sezione D del report non fatti: *tema scuro C e Am simili* (osservazione 3: richiede una tavolozza nuova, rischio di regressioni nel contrasto, rinviato); *"Esporta libreria" disabilitato che sembra attivo* e *la schermata del brano senza testo nel primo schermo* (decisioni di layout della v1, rinviate); *"+ pausa"/"Registra" poco chiari* (serve un testo guida, non una correzione). Fatto invece: «Primo accordo!» sempre in vista, messaggi non tagliati, indizi di loop e clic, ancore visibili.
8. **Spaziatura del testo**: l'etichetta sta in un contenitore di larghezza zero e sporge sopra il testo; il segmento si allarga solo se `col(successivo) − col(questo) < lunghezza + 1`, di quanto manca (segmenti senza testo: `lunghezza + 1`). Sul file reale (`round5-text.cjs`, righe con un vuoto più largo degli spazi originali, prima → dopo): **360 px 42 → 0 (scala 1,0), 37 → 0 (2,0); iPhone SE 41 → 0 e 37 → 0; iPhone 13 42 → 0 e 38 → 0**, su 135 righe. Etichette sovrapposte: 0 in tutti i casi; scroll orizzontale: 0. Restano 3 segmenti allargati (2 righe strumentali, 1 accordo oltre la fine della riga): non hanno testo da spostare. Caso residuo: a 360 px e scala 2,0 quattro etichette «Em» sporgono di circa 5 px oltre il bordo dello schermo e sono tagliate (`overflow-x: clip` evita lo scroll).
9. **Pulizia**: `README.md` riscritto (funzioni, build, test, script e2e, sezione provvisoria «Usarla sul telefono»); `docs/DECISIONS.md` con «Round 5» e «Limiti noti della v1»; `test/regression/` rimossa (vuota); nessun file di debug aggiunto. Corretto un errore latente: `click()` in `audio.js`/`player.js` poteva programmare un tempo negativo su un `AudioContext` appena creato (`RangeError` visto da `round5.cjs` R7); ora il tempo è limitato a ≥ 0.

## Script e2e rilanciati (build finale, Chromium emulato)

| Script | Esito |
| --- | --- |
| `ui-round1.cjs` | 76 PASS, 0 FAIL |
| `round2.cjs` | 18 PASS, 0 FAIL |
| `round3.cjs` | 25 PASS, 0 FAIL |
| `round3-panel.cjs` | senza errori; pannello 112 px (360 px) / 99 px (iPhone 13), prima 108/95: a iPhone 13 con scala 1,5 la riga corrente in un caso mostra 4 righe intere contro 5 |
| `round4.cjs` | ALL PASSED (aggiornato: S6 non si aspetta più un suggerimento per uno scarto di 0,12 s su 5 s, rimette l'ancora tolta, S8 conta 2 ancore) |
| `round4-tester-audio.cjs` | 46 PASS, 0 FAIL (B3W ora attende «Nella sezione Finale l'audio va il 1,1% più lento: −1 BPM circa», un solo suggerimento; nuovo controllo B3G: vuoto prima dell'ancora 0 ms) |
| `round4-tester-anchors.cjs` | ⚓ dopo "Fatto" e dopo il reload |
| `round5.cjs` (nuovo, SE e 13) | ALL PASS (67 controlli) |
| `round5-text.cjs` (nuovo, file reale, 360/SE/13) | 0 sovrapposizioni, 0 scroll, vedi sopra |

Screenshot guardati con lo strumento Read: schermata di sincronizzazione (SE e 13, appena caricato l'audio, con ancore, suggerimento, foglio dell'ancora), pannello con loop attivo (SE e 13), testo prima/dopo (360, SE, 13).

## Non verificato / limiti

- Nulla su telefono vero (Wake Lock, cuffie Bluetooth, Safari): vedi «Limiti noti della v1» in `docs/DECISIONS.md`.
- La barra di sincronizzazione su un iPhone SE vecchio (320×568) occupa il 21,7%, sopra il 20% richiesto per 375×667.
- Il pannello è 4 px più alto (icona del clic): su schermi bassi con scala 1,5 lascia una riga di testo in meno in un caso.
- Il clic di «Ascolta» e il registratore a tap non cambiano (limiti già noti).

## Decisioni prese (tutte in `docs/DECISIONS.md`, sezione «Round 5»)

Fattore unico per il suggerimento e la scala della timeline; soglia sull'errore di tempo; ⚓ visibili anche con audio mancante; foglio ±10/±50 al posto dei ±0,1 s; badge asincrono in libreria; «Primo accordo!» sul primo accordo vero; barra fissa con «⋯»; messaggi come foglio fisso; etichette a larghezza zero con allargamento solo in caso di collisione.
