# Round 3 — Implementatore: trasposizione, capotasto, diagrammi, libreria (M5)

Leggi `CLAUDE.md`, `docs/SPEC.md` (sezione "Strumenti", milestone 5), `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md` e i report del round 2.

## 0. Correzioni dal round 2

Vedi la sezione "Correzioni" in fondo (scritta dal coordinatore dopo il report del tester). Falle **per prime**, ciascuna con un test.

## 1. Trasposizione: `src/transpose.js` (puro)

```js
transposeChord(name, semitones, { preferFlats }) -> string     // usa parseChord di chord.js
estimateKey(song) -> { root: 'G', minor: false }                // song.key se presente, altrimenti euristica
transposedKey(key, semitones) -> key
usesFlats(key) -> boolean                                        // F Bb Eb Ab Db Gb; Dm Gm Cm Fm Bbm Ebm
displayChordName(song, name) -> string                           // applica song.transpose (e, se attivo, la vista "forme col capotasto")
```

- Si traspongono la fondamentale e il basso (`D/F#` → `E/G#`); la qualità resta identica (`m7b5`, `sus4`, `add9`…).
- `estimateKey`: se `song.key` manca, punteggio per ciascuna delle 24 tonalità: accordi diatonici del brano pesati per durata in battiti, bonus se primo o ultimo accordo è la tonica. Sul file reale deve uscire Sol maggiore.
- Ortografia: diesis o bemolle in base a `usesFlats(transposedKey)`. Per Fa# / Solb maggiore scegli diesis (documenta).
- Proprietà da testare: per ogni accordo di una lista ampia (tutte le radici × qualità comuni × slash), `transpose(transpose(x, n), -n)` e `transpose(x, 12)` tornano al nome originale **normalizzato**; ±1…±12 sul file reale torna all'originale (criterio M5).
- UI: pulsanti − / + mezzo tono nell'intestazione, indicatore "+2" / "Originale", tocco sull'indicatore → torna a 0. Salvato in `song.transpose`. Tutto (testo, chip, pannello del player, colori per accordo) usa `displayChordName`. I colori restano legati all'accordo originale, così non cambiano trasponendo.

## 2. Suggerimento capotasto

```js
chordDifficulty(name) -> number          // tabella: aperti facili bassi, barré alti, rari/sconosciuti altissimi
suggestCapo(song, { maxCapo: 7, top: 3 }) -> [{ capo, shapes: ['G','C','D'], score }]
```

- Per capo `c` da 0 a 7: le forme da suonare sono gli accordi (già trasposti di `song.transpose`) trasposti di `-c`. Punteggio = somma pesata per battiti della difficoltà delle forme (accordi più frequenti contano di più).
- Difficoltà suggerite (adatta e documenta): C, G, D, A, E, Am, Em, Dm = 1; loro 7 (G7, D7, A7, E7, C7, B7, Am7, Em7, Dm7) e sus/add9 aperti = 1,5; F, Fmaj7, Bm = 3; altri barré = 4; slash comuni aperti (D/F#, G/B, C/G, C/E, Am/G) = 2; resto 5.
- UI: in un foglio "Capotasto", le 3 opzioni migliori ("Capo 2: forme G, C, D — facile"), con quella corrente evidenziata. Scegliendone una: `song.capo` aggiornato e opzione "mostra le forme da suonare" (vista forme: gli accordi mostrati sono le forme, con l'intestazione "Capo 2 — forme"). L'intestazione del brano mostra sempre il capotasto attivo.
- Test sul file reale: con transpose 0 la migliore è capo 0 (già G/D/Em/Am/C/A). Con transpose +2 (A B F#m Bm D B) la migliore è capo 2 con forme G D Em Am C A.

## 3. Diagrammi: `src/chords-db.js` + `src/diagram.js` (puri)

- Formato forma: `{ frets: [x|0..n per 6 corde, dal Mi basso], fingers?: [...], baseFret: 1, barres?: [{ fret, from, to }] }`.
- **Aperti a mano**: tutti i maggiori/minori/7 aperti comuni, m7, maj7, sus2, sus4, add9 aperti dove esistono, e gli slash comuni (D/F#, G/B, C/G, C/E, Am/G, A/C#, F/C, Em/D, D/A, G/D).
- **Barré generati** da modelli forma-Mi e forma-La per maj, m, 7, m7, maj7, sus4, sus2, m7b5, dim7, 6, m6, 9, così ogni radice ha almeno una forma per quelle qualità. Scegli la forma con il tasto più basso tra forma-Mi e forma-La.
- `getChordShape(name) -> shape | null`. Gli enarmonici si risolvono (A# = Bb). Slash non in tabella: forma dell'accordo base con il basso indicato sotto ("basso: F#"). Accordo sconosciuto → `null` e la UI mostra il nome con "diagramma non disponibile".
- `renderDiagramSvg(shape, { size, label, theme }) -> string`: griglia 6 corde × 5 tasti, capotasto spesso se `baseFret = 1` altrimenti numero del tasto, pallini, barré come barra arrotondata, `x`/`o` sopra. Usa `currentColor` così segue il tema. Nessun testo minuscolo: il numero del tasto deve leggersi a 64 px.
- Test: ogni forma ha 6 valori validi; nessun tasto > baseFret + 4; i 6 accordi del file reale e tutte le loro trasposizioni ±12 hanno un diagramma; un controllo che per i maggiori/minori le note suonate (dall'accordatura E A D G B E) siano solo note dell'accordo.
- UI: fila dei diagrammi nell'intestazione del brano (al posto dei chip, scorrevole in orizzontale *dentro la fila*, senza scroll della pagina); tocco su un accordo nel testo → diagramma grande nel foglio (finalmente), con le forme alternative se più di una. Il pannello del player mostra il diagramma piccolo dell'accordo corrente e del prossimo.
- I diagrammi seguono trasposizione e vista forme col capotasto.

## 4. Libreria completa

- Ricerca per titolo/artista (senza accenti e maiuscole), ordinamento per ultimo aperto / titolo / artista, data di import, difficoltà, numero di battute se le durate sono modificate (badge "durate ✓").
- **Esportazione**: un file `accordi-a-tempo-AAAA-MM-GG.json` = `{ app: 'guitarapp', exportVersion: 1, exportedAt, songs: [Song…], settings }`, senza audio (campo `audio` mantenuto solo come metadati, se presente). Scaricato con `Blob` + `<a download>`; su iOS, se il download non parte, ripiego su `navigator.share({ files })` quando disponibile.
- **Importazione**: scegli il file, validazione (`validateSong` dopo `migrateSong` per ogni brano), anteprima "N nuovi, M già presenti". Per quelli presenti: "Sostituisci se più recenti" (per `updatedAt`) / "Sostituisci tutti" / "Salta". I brani non validi si saltano con un elenco degli errori. Nessun brano esistente perso in caso di errore a metà (prima valida tutto, poi scrivi).
- Test: andata e ritorno export → import su storage pulito produce brani identici (deep equal); import di file malformati (JSON rotto, versione sconosciuta, brano senza sezioni) dà errori leggibili e non modifica la libreria.
- Indicatore dello spazio usato in localStorage nella schermata impostazioni/libreria (stima in KB).

## Consegna

Come i round precedenti: commit piccoli con test verdi, niente push, verifica Playwright con screenshot guardati (diagrammi in tema chiaro e scuro, foglio capotasto, libreria con ricerca, export/import andata e ritorno usando `page.waitForEvent('download')`), `docs/reports/round-3-impl.md` e risposta finale di 10–15 righe.

## Correzioni dal round 2

(da completare dopo il report del tester)
