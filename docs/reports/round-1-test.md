# Report round 1 — tester

Verifica indipendente di M1 + M2 su `dist/index.html` e sul file reale. Nessun testo del brano reale è riportato qui né nei test committati. Screenshot in `test-artifacts/round-1/` (non versionati, guardati uno per uno).

Script miei (eseguibili a parte, non fanno parte di `npm test`):
- `node test/e2e/parser-independent.mjs` — ricalcolo indipendente dei valori sul file reale (regex/indexOf proprie, non il codice del parser).
- `node test/e2e/parser-robustness.mjs` — varianti sintetiche e input malformati.
- `npm run build && node test/e2e/ui-round1.cjs` — C1–C12 con Pixel 7, iPhone 13 (emulati in Chromium) e viewport 360 px.
- `node --test "test/regression/*.test.js"` — due test `todo` che riproducono i bug 3 e 4 (falliscono per ora, non fanno parte di `npm test`; `node --test test/regression/` non funziona su Node 22).

## Esiti

| Punto | Esito | Evidenza |
| --- | --- | --- |
| A1 | PASSA | 66 test, 66 verdi, 0 skip, 0 todo. Il test sul file reale gira (file presente, non skip). |
| A2 | PASSA | Build ok, 53265 byte, 12 moduli. Nessun `http(s)://`, `fetch(`, `src=`/`href=` remoti in `dist/index.html`; in Playwright 0 richieste non-file su tutti e tre i profili. |
| A3 | PASSA con riserve | Le asserzioni su titolo, artista, difficoltà, accordatura, capo, 12 sezioni, 328, distinti, ritmi 62/96/142 con 16/8/8, 22 righe `*` sono esatte (`===`), non deboli. Deboli: le colonne `col` sono controllate solo con `col <= lyric.length + 20`; il numero di righe solo con `100 <= n <= 317` (reale: 137); manca il conteggio dei 38 accordi con `*`; `onBeat` e direzioni dei ritmi non sono verificati sul reale. Le ho coperte con `parser-independent.mjs`. |
| B | PASSA | 328 accordi in ordine identici al mio conteggio indipendente; distinti `G D Em Am C A`; 12 sezioni (nomi uguali ai miei); metadati ok; ritmi 62/96/142 con 16/8/8 celle (le 17/9/9 che conta una regex grezza includono il contenitore); `*`: 22 righe e 38 accordi, uguali al mio conteggio. Nessun residuo (`bidding`, `primis`, `<`, `>`, `&nbsp;`, `&amp;`, U+FFFD, NBSP). `col` verificate su tutte le 135 righe accordi (non solo 10) con una camminata indipendente: 0 differenze; testi abbinati correttamente (133 con testo, 2 strumentali). 5 varianti sintetiche concordi. Input brutti (vuoto, txt, MHT troncato, senza `<pre>`, pre non chiuso, base64/QP rotti, nidificazione 50000) danno errore italiano leggibile o brano vuoto con avvisi, mai crash. Eccezioni: bug 3 e 4. |
| C1 | PASSA | `*-c1-empty.png`: titolo, bottone «Importa .mht», istruzioni in 3 passi leggibili. |
| C2 | PASSA | Intestazione corretta, 12 sezioni, 328 etichette, 6 chip. File non valido (txt, vuoto): messaggio «Impossibile importare «…»: …» leggibile. |
| C3 | PASSA | `scrollWidth == innerWidth` (412 / 390 / 360) in libreria e nel brano a scala 1.0, 1.5, 2.0 (massimo). |
| C4 | PASSA con riserve | 309 etichette controllate (su 328: 16 su spazio bianco, 1 oltre la fine della riga, 2 strumentali) a 1.0/1.5/2.0 su 3 profili: 0 fuori tolleranza, scarto massimo 0,0 px. Attenzione: l'allineamento al carattere è garantito dalla struttura (etichetta e frammento sono nello stesso `inline-block`), quindi misura poco; i problemi reali sono nei bug 1 e 2. |
| C5 | PASSA | 328 etichette, 0 coppie sovrapposte, a tutte le scale e profili. |
| C6 | PASSA | A−/A+ limitati a 0,7–2,0; tema e dimensione restano dopo reload; sono per brano (secondo brano parte a 1,0 mentre il primo resta 1,3). |
| C7 | PASSA | Compresso: 3 `details` («come sopra») e 328 etichette nel DOM; aperto: 12 sezioni, 328 etichette; il summary apre e chiude. |
| C8 | PASSA | Tocco su etichetta e su chip apre il foglio con il nome giusto; si chiude con Chiudi, sfondo, Esc. Area visibile dell'etichetta 23×26 px, estesa a ~41×44 px dallo pseudo-elemento. |
| C9 | PASSA | Dopo reload i brani ci sono; eliminazione: «annulla» non cancella, «ok» sì, anche dalla schermata del brano; nessuna chiave residua in localStorage. |
| C10 | PASSA | `history.back()` dal brano torna alla libreria, sia da elenco sia dopo import. |
| C11 | PASSA con riserve | Testo 15 px mono a scala 1: leggibile; contrasto buono nei due temi; i 6 colori sono distinguibili (G/D e C/Am sono i più vicini, ma c'è anche il nome). Riserve: parole spezzate (bug 1), spazi extra (bug 2), icona tema poco chiara (bug 5). |
| C12 | PASSA | 0 errori/avvisi in console su tutti i profili. |

## Bug (per gravità)

**1. IMPORTANTE — Parole spezzate a metà quando la riga va a capo.** Con un accordo a metà parola il frammento è un `inline-block` e il browser può andare a capo tra un frammento e l'altro senza trattino: «tim / e», «re / member», «a w / hile», «cou / ldn't». Misurato sul file reale: 111 accordi a metà parola; parole spezzate su più righe: 0–3 a scala 1,0 (360–390 px), 13–14 a scala 1,5, 8–14 a scala 2,0. Passi: importare il file reale, viewport 360 px, A+ fino a 2,0 (`w360-c4-scale-2.png`, `pixel7-c6-after-reload.png`). Atteso: la parola resta intera (a capo prima della parola, con l'etichetta sopra il frammento giusto). Sospetto: `src/render.js` `renderLine` (i `.seg` e il testo `s.rest` sono fratelli inline) e `.seg { display: inline-block }` in `src/styles.css`; raggruppare ogni sequenza senza spazi in un contenitore `white-space: nowrap`.

**2. MINORE — Accordo su uno spazio: spazio in più e testo spostato.** 16 accordi del file reale cadono su uno spazio; `s.word || ' '` inserisce un carattere segnaposto e `min-width` sposta il testo successivo: spazi doppi o tripli dentro la riga e uno spazio iniziale su una riga. Scarto fino a 27 px a scala 1,0 e 54 px a 2,0. Atteso: nessuno spazio aggiunto. File: `src/render.js` (`renderLine`, riga con `s.word || ' '`). L'implementatore lo dichiara come previsto dal piano.

**3. MINORE — Span accordo senza nome produce accordi con nome vuoto.** `<span class="…js-chord-chord"></span>` o `data-original-chord=""` danno `{ name: "" }` (test `todo` in `test/regression/`). Atteso: scartare lo span o avvisare. File: `src/parser.js` `analyseSpanLine` (calcolo di `name`). Non succede nel file reale.

**4. MINORE — Tempo quadratico con molti span non chiusi.** 20000 span accordo non chiusi in un `<pre>`: 14,7 s (6000: 1,3 s). Atteso: lineare o errore rapido. File: `src/parser.js` `analyseSpanLine` con `findElementEnd` per ogni span. Solo input malformato/ostile; il file reale impiega pochi ms.

**5. MINORE — Icona del tema poco chiara.** Il pulsante tema mostra `◐` che in Chromium appare come una mezzaluna minuscola e tagliata (barra in alto negli screenshot). Sul telefono il glifo può cambiare. Suggerimento: SVG inline o testo. File: `src/ui/songview.js` `themeBtn`.

**6. MINORE — Reimportare lo stesso file crea un duplicato** (3 righe dopo tre import). Da decidere se è voluto (non è in spec).

Osservazione non bug: le sezioni ripetute identiche sono 3 su 12 (Chorus 4, 5, 6 sono «come sopra»; Chorus 2 e 3 hanno contenuto diverso dal primo).

## Non verificato

- Safari/iOS e telefono reale: l'iPhone 13 è emulato in Chromium (motore, font e `accept` del file input possono differire). Il font mono di sistema sul telefono reale cambia larghezze e a capo.
- Selezione file reale da browser mobile (`accept`), perché `setInputFiles` la aggira.
- `dist/index.html` da server statico (solo `file://`).
- Il criterio della spec «provato su un telefono vero» resta aperto.
