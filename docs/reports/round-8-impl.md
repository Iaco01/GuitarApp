# Round 8 — Report implementatore

Robustezza della sincronizzazione automatica, punti 1–8 di `docs/rounds/round-8-impl.md`. Nessun testo del brano reale è riportato: solo tempi, nomi di sezione, conteggi. Decisioni in `docs/DECISIONS.md` ("Round 8").

## Numeri

### 1. Audio più lungo del foglio (bug 1)

`node test/e2e/round8-long.mjs` (generatore del tester, seme 3, 61 eventi; "stabili" = tutte le sezioni tranne la libera; entro 250 ms dalla verità, una qualsiasi copia ammessa). Prima = round 7.

| caso | prima | ora (stabili) | gap trovati |
|---|---|---|---|
| controllo (1×) | 100% | 100% | – |
| 1,25× (inizio ripetuto in coda) | null | 100% | – |
| 1,35× | null | 100% | – |
| 1,5× | null | 100% | – |
| 2× (brano due volte) | null | 98,2% | – |
| Chorus suonato una volta in più | – | 100% | 1:05–1:21 |
| Bridge due volte in più | – | 100% | 1:34–1:56 |
| Outro suonato una volta in più | – | 92,7% | – (la copia è in coda) |
| Verse ripetuto 1×/2× nel mezzo (progressione periodica, solo informativo) | 74,5% / null | 100% / 100% | 0:47–1:11 / 0:47–1:35 |
| 20 s di altra musica prima del brano | 89% | 100% | – |

Nell'app (`round8.cjs robust`, mp3 con il Chorus ripetuto): 8 sezioni "gggygggg", riga "1:05–1:21: parte non presente nel foglio", 47/47 eventi del foglio entro 250 ms. Con `round7-tester-robust-app.cjs` il caso `longer` (brano doppio) esce "gggygggg" (prima: "Non sono riuscito ad allineare"). Il sintetico normale non peggiora: tester 100/100/100% sul tempo stabile (tre semi), `autosync-bench` 98,2% entro 250 ms (97,3–98,2% prima), reale: controllo indipendente locale 59,2% (56,7% prima), BPM e trasposizione invariati.

### 2. Confidenza → accuratezza vera (bug 2)

`node test/e2e/round8-confidence.mjs`: 6 tracce a seme con varianti (pulito, rumore 0,1 e 0,25, decadimento rapido, senza batteria/voce, 3 accordi mancanti, audio tagliato al 60%) del generatore del tester + 3 semi × 3 varianti del generatore dell'implementatore: 2202 cambi, 229 sezioni. Quota dei cambi entro 250 ms dalla verità, per **stato** della sezione:

| stato | sezioni | cambi | entro 250 ms | peggiore sezione |
|---|---|---|---|---|
| tempo stabile, verde (conf ≥ 0,75) | 187 | 1874 | 98,8% | 75% |
| tempo stabile, giallo (0,5–0,75) | 2 | 34 | 97,1% | 94% |
| tempo stabile, rosso (< 0,5) | 0 | – | – | – |
| tempo libero, giallo (≥ 0,4) | 21 | 166 | 77,1% | 0% |
| tempo libero, rosso (< 0,4) | 21 | 128 | 38,3% | 0% |

Per **confidenza di sezione**: stabile 0,65–0,75: 97% (2 sez.), 0,75–0,9: 98% (24), 0,9–0,97: 98% (13), ≥ 0,97: 99% (150). Libero: < 0,2: 6% (10 sez.), 0,2–0,4: 58% (11), 0,4–0,5: 54% (7), 0,5–0,56: 87% (14).

Lettura onesta: (a) verde ≥ 90% e rosso < 50% sono rispettati (verde 98,8%; rosso del tempo libero 38%). (b) Sul banco le sezioni a tempo stabile sono quasi tutte giuste, quindi la tabella non mette alla prova la zona 0,5–0,65 né il rosso del tempo stabile: quelle soglie sono prudenti, non verificate. (c) Il tempo libero resta il punto debole: giallo vuol dire 77% in media ma "da 0% a 100%" per sezione (la sezione del tester con arpeggio è sbagliata di 0,4–0,9 s con punto nitido, quella del mio generatore è giusta al 94–100%). La nitidezza (spostando il cambio di ±0,25/0,5/1 s il punteggio peggiora) separa poco gli errori di modello; ho aggiunto il tetto 0,55 e il "mai verde". Test del tester: eventi 28–32 ora hanno confidenza < 0,6 o errore ≤ 250 ms (0,29–0,55 sui tre semi). Sul reale: 6 verdi, 6 gialle, 0 rosse (round 7: 5/5/2); Verse 1 e 6 e il Chorus finale sono "tempo libero → giallo".

### 3. Tempi con CPU ×4 (bug 6)

Stesso script del tester (`round7-tester-app.cjs perf SE`, mp3 reale, CPU ×4):

| | round 7 | ora |
|---|---|---|
| totale decodifica + analisi | 17,7 / 18,5 s | 11,6 s (altre corse: 11,4–13,4 s; 360 px: 11,8 s) |
| di cui analisi | 15,4 s | 9,4 s |
| fetta più lunga dell'analisi (sua stima) | ~1 s | 126 ms |
| frame più lungo | 1,15 s | 199 ms |
| frame > 250 ms | 6 | 0 |
| annulla a metà | 426 ms | 687 ms |

Obiettivi (< 14 s, frame < 200 ms) raggiunti, il frame di poco. In Node: 3,1 s → 2,0 s (feature 2,1 → 1,2 s: FFT con copia a bit invertiti, due primi stadi radix-4, niente `Math.hypot`, solo i bin che servono). Punti caldi trovati con un profilo CDP della pagina a ×4: Viterbi (ora cede ogni ~1,5 milioni di passi), mix mono a fette (`toMono` bloccava 560 ms: `decodeAudioData` restituisce il file con i suoi canali, anche con contesto mono), somma dei quadrati e normalizzazione, sintonia, curve di tempo, una cessione per sezione. Le cessioni usano `MessageChannel` (i `setTimeout` annidati costano ≥ 4 ms). **Nessun Web Worker**: non serve per l'obiettivo e la build resta un file solo (se servisse: `new Worker(URL.createObjectURL(new Blob([codice dei moduli di src/analysis concatenati dalla build])))`, non fatto).

### 4. Rumore e "pronta" (bug 4)

Margine della trasposizione relativo al punteggio: veri 0,19–0,25; rumore bianco 0,003–0,02; silenzio 0; altro brano 0,01. Soglia 0,10 (`TRANSPOSE_MIN_RATIO`). Rumore (150 s) e silenzio digitale nell'app: "Audio non riconosciuto: è il brano giusto?…", nessun allineamento salvato, nessun riquadro di trasposizione, nessun "pronta" (`round8.cjs robust`, `round7-tester-robust-app.cjs`). Audio più corto del brano (taglio a 75 s): 4 sezioni rosse su 8, sotto il 75%: resta "pronta" con le sezioni rosse (il messaggio non dice che l'audio è più corto: non fatto).

## Cosa non funziona / limiti

- **Tempo libero**: gli errori di modello (arpeggio lento, il cambio di accordo si vede solo dopo alcune note) restano; ora sono segnalati (rosso se la nitidezza è bassa, giallo al massimo, eventi < 0,6) ma non corretti. Stabile 0% entro 250 ms sul tester nella sua sezione libera, 94–100% sul generatore dell'implementatore.
- **Ripetizioni di una sezione con una progressione periodica** (Am F C G ×3): il gap può cadere su una copia o sull'altra (entrambe valgono, il test lo ammette) e, con costi di gap diversi da quelli scelti, il percorso scivolava di un ciclo di 8 s; con l'emissione "miglior accordo − 1" è stabile sui casi provati, ma è un punto delicato.
- **Soglie di colore**: non verificabili sotto 0,65 a tempo stabile (nessuna sezione sintetica ci arriva) e sul reale manca una verità.
- **Gap**: durante un gap l'evidenziazione resta sull'ultimo accordo (nessuna indicazione "fuori dal foglio" in play, solo nel riepilogo). Gap solo tra sezioni (non dentro).
- **Audio più corto**: nessun avviso dedicato.
- **Trasposizione** a margine basso con audio vero ma molto rumoroso non viene più proposta: l'utente la imposta a mano.

## Cambiamenti per punto

1. Gap tra sezioni e agli estremi (`align.js`: Viterbi con massimo corrente, emissione = miglior accordo − 1, costo 4; fattibilità delle fasce); `gaps` in risultato, allineamento (`alignment.gaps`, normalizzato all'import), `effectiveEventTimes` (`ends[]`, `gaps[]`), timeline (`gaps`, evento che finisce dove inizia il gap); riga nel riepilogo.
2. Nitidezza del cambio (`sharpness`), confidenza = min(somiglianza, rampa), mediana di sezione, tetto 0,55 e "mai verde" per il tempo libero, soglie 0,75 / 0,5 (libero 0,4).
3. − / + disattivati con la nota fissa (anche campo del numero); `setBpmLocked` in `playpanel.js`.
4. `transposeTrusted`, `alignmentRecognised`, messaggio e niente salvataggio.
5. Stile `:disabled` globale; "Prossimo: Em · mancano N tocchi", "Annulla ultimo tocco", salvataggio parziale con elenco degli accordi senza tempo (`replaceSectionStarts(..., { partial })`).
6. Vedi sopra.
7. Da fermo il pannello mostra il ritmo della prima sezione: altezza uguale da fermo e in play (360 px reale con ritmo: 136,48 px in entrambi; sintetico allineato 150,48; SE e 13: stessa cosa).
8. Righe da 54 px (prima 105–122): nome, tempo, stato e BPM, ▶ e ✎ da 44 px; barra fissa in basso con avviso, trasporto e "Fatto"; l'avviso non copre le righe (il contenuto ha il margine della barra); la riga "Verse 1 · Em" non resta più a musica ferma.

## Test e script

- `npm test`: 210 test (erano 197): `test/gaps.test.js`, `test/round8-fixes.test.js`, `test/round8-engine.test.js` (sintetico a 11 kHz, circa 5–10 s); `test/regression/` rimossa: i 3 `todo` sono test normali e passano.
- Nuovi script: `test/e2e/round8-long.mjs`, `round8-confidence.mjs`, `round8.cjs` (pannello, − / + bloccati, schermata di sincronizzazione, correzione con tocchi mancanti, rumore, Chorus ripetuto).
- E2E rilanciati: `round4.cjs` ALL PASSED; `round5.cjs all` ALL PASS; `round6.cjs` 26 PASS; `round7-panel.cjs` 10 PASS; `round7.cjs flow` su 360, SE e 13 ALL PASS; `round7.cjs perf` 11,8 s; `round7-tester-a.cjs` ALL PASS; `-core.mjs` ALL PASS; `-engine.mjs all` ALL PASS; `-robust-app.cjs` senza errori (`longer` e `noise` come sopra); `-user.cjs` completata (riga da 54 px); `-app.cjs` `cancel` e `persist` ALL PASS, `perf` ALL PASS; `synth`: 1 FAIL atteso (C3c "evidenziazione dal vivo nella sezione libera entro 250 ms", era già "weak spot": media 669 ms, ora la sezione è rossa/gialla con confidenza bassa); `correct`: 1 FAIL previsto (C4a, "con un tocco saltato non si può salvare": ora si può, decisione del punto 5); `round6-tester-browser.cjs` 61 PASS; `-fuzz.mjs` ALL PASSED; `round6-tester-core.mjs` A1 2 FAIL come nel round 7 (confronta con una tabella del report del round 6). `round8.cjs all` su 360 (singole parti), SE e 13: 30 PASS ciascuno, nessun errore di pagina.
