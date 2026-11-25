# Round 6 — Report del tester

Verifica indipendente di durate stimate e BPM − / + dal pannello. Nessun testo del file reale è riportato (solo nomi di accordi, conteggi, tempi). Script: `test/e2e/round6-tester-core.mjs` (A), `round6-tester-fuzz.mjs` (robustezza), `round6-tester-browser.cjs` (B, A5). Screenshot in `test-artifacts/round-6/tester/` (non versionati).

## Esito

| Punto | Esito |
|---|---|
| A1 sillabe vs tabella | OK con differenze minime |
| A2 proprietà sul file reale | OK, 0 violazioni |
| A3 giudizio musicale | plausibile, 1 caso "attacco anticipato" |
| A4 migrazione | OK |
| A5 impostazione Durate | OK |
| B1 nessun salto, nuovo tempo, nessun doppio clic | OK |
| B2 scala proporzionale e ritorno esatto | OK (un limite: clamp 300) |
| B3 pressione prolungata (mouse e touch CDP) | OK |
| B4 con audio, Annulla | OK |
| B5 persistenza, altezza pannello | OK; ritmo illeggibile (bug 1) |
| C regressione | OK |

## A. Durate stimate

1. **Contatore indipendente** (regole mie: gruppi vocalici, "e" muta, -ed/-es; sillaba di un accordo = parte della parola in cui cade la colonna). Prima strofa (35 accordi): le sillabe coincidono su 26, differiscono di 1 su 9 (accordi n. 4, 5, 6, 7, 15, 25, 26, 29, 31), mai di 2 o più; totale 112 (report) contro 107 (mio). Primo ritornello (16 accordi): coincidono tutte (53 contro 53). Le differenze vengono da parole con "-ed"/"-es"/"e" finale e dal punto in cui cade l'accordo dentro la parola. Le durate nella tabella del report coincidono con quelle dell'app.
2. **Proprietà sul file reale** (12 sezioni, 328 accordi): totale multiplo di 4: 0 violazioni; durata < 1: 0; media fuori da 3–5: 0 (tutte 4,00). Ritornelli: 4 sezioni con contenuto identico (ritornelli 2–5) hanno durate identiche (0 violazioni). Il primo e l'ultimo ritornello hanno testo diverso (nel testo differiscono di qualche carattere) e quindi durate diverse: corretto, ma il primo ha 2,2,6 dove gli altri hanno 1,3,4 (una sola sillaba di differenza sposta tutto). Monotonia con le MIE sillabe: 0 violazioni su 3854 coppie (anche con soglia di 3 sillabe: 0/981). Correlazione durata-sillabe 0,87. Istogramma: 1×20, 2×74, 3×12, 4×136, 5×2, 6×62, 8×19, 10×3.
3. **Casi estremi**: i più lunghi (10 battiti) sono Em con 7–8 sillabe (ritornello, strofa 4); gli 8 battiti hanno 4–7 sillabe. Nessun accordo ≥ 6 battiti con ≤ 2 sillabe e nessuno ≤ 2 battiti con ≥ 5 sillabe: plausibile. 20 accordi su 328 durano 1 battito, quasi tutti nei tre accordi finali di strofa (C-D-G ravvicinati, cambi rapidi), dove 1,1,1,3 o 1,1,5 è discutibile (un accordo da 5 battiti non è musicale). Il caso "primo accordo lungo, secondo da 1" (G 3 / D 1) è **1** (strofa 1); il primo accordo di sezione dura meno di 4 in 7 sezioni su 12, ma gli altri casi non hanno un secondo accordo da 1.
4. **Migrazione**: schema 2 con `timingSource: 'default'` diventa schema 3 `estimated`, 8 valori distinti, identico alla stima diretta; `edited` e `recorded` restano intatti (primo accordo a 7, gli altri a 4); anche senza `timingSource` viene stimato.
5. **Impostazione Durate** (Playwright): media 8 senza conferma (media 8,00), ritorno a 4 identico all'import; con durate modificate a mano compare la conferma: Annulla non cambia nulla, OK riscrive con la stima identica all'import; modalità e valori restano dopo il reload.
6. **Robustezza** (fuzz, 4000 sezioni casuali con righe senza testo, pause, colonne oltre il testo, accenti, righe da 10000 caratteri; tempi 4/4, 3/4, 6/8; medie 2/4/8): 0 eccezioni, 0 NaN, tutti interi, totale multiplo di battuta, pause intatte. File reale con media 2 e 8: totali multipli di 4. L'input non viene modificato; la stima non dipende dalle durate precedenti.

## B. BPM dal pannello

1. **Nessun salto** (file reale, 360 px, clic intercettati a livello Web Audio): 6 pressioni a fasi diverse del battito, variazione massima della posizione 0,022 battiti (è il ritardo di un frame), nessun evento saltato. Il primo clic dopo il cambio arriva dove dice la posizione continua (scarto −0,5 ms), i clic successivi hanno distanza esatta del nuovo tempo (0 ms di errore), esattamente un clic tra prima e dopo (nessun doppio, nessuno perso), nessun oscillatore programmato nel passato. Cambi di accordo successivi: errore massimo 10 ms rispetto alla timeline. Premere da fermo, durante il conteggio e da pausa: cambia il BPM, la posizione non si muove (pausa: −0,02 s di arrotondamento).
2. **Scala proporzionale**: +1 −1 ritorna esattamente a 62/96/142; 10 × + poi 10 × − torna esattamente ai valori iniziali di tutte le 12 sezioni (merito dello snapshot); dopo +10 i rapporti restano entro 0,02 BPM. "Solo questa sezione" cambia solo quella (anche nel test del implementatore, rieseguito). Limite: scrivendo 299 le sezioni a 142 e 96 si appiattiscono a 300 e i rapporti si perdono in modo irreversibile senza audio (non c'è "Annulla"). Valore 400 rifiutato con messaggio. Dopo ogni modifica tutte le sezioni diventano `bpmSource: 'edited'` anche se tornano ai valori iniziali (innocuo).
3. **Pressione prolungata**: 2,05 s = 9 passi (mouse, touch reale via CDP, 360 e SE: 9,0 in tutti i casi), nulla dopo il rilascio; un tap = esattamente +1 (nessun doppio con il clic emulato); scivolando via con il dito la ripetizione si ferma. `touch-action: manipulation`, `user-select: none`.
4. **Con audio** (traccia sintetica, SE): 12 pressioni (6 rapide, 6 lente), l'audio non si sposta (massimo 0,2 ms rispetto all'orologio), resta in play a velocità 1; l'evidenziazione segue la nuova timeline; la nota dice "+12 BPM su tutto il brano"; "Annulla" ripristina esattamente 70/96/142/96 e nasconde la nota; dopo Annulla una nuova serie riparte (−2).
5. **Pannello**: altezza identica prima, durante e dopo le pressioni (112,5 px a 360; 99 a SE e 13); campo BPM aperto = 206,5/193/193 px, dentro la larghezza; nessun pulsante fuori schermo; ricarica: valori conservati. Pulsanti − / + 40×40 px (sotto 44), "⋯" 44×36.

## Bug

1. **Media, UX**: il ritmo (frecce) nel pannello è illeggibile su tutti e tre gli schermi, non solo a 360 px. Il box è largo 18 px (360), 33 (SE), 48 (iPhone 13) per 16 celle da 6 px (servono 112 px): si vedono 3–8 frecce ritagliate. Durante il play la cella corrente è dentro la parte visibile solo 8 volte su 31, quindi il ritmo non segue più il battito. Il report dell'implementatore parlava solo di 360 px (19 px) e di "ancora leggibile" per iPhone 13: non lo è (screenshot `13-panel-play.png`). Correzione possibile: far scorrere il box in modo che la cella corrente sia visibile, mostrare solo le 4–8 celle intorno, o nascondere il ritmo sotto una soglia.
2. **Bassa**: il clamp a 300 BPM appiattisce i rapporti tra sezioni senza possibilità di annullare (solo con audio c'è "Annulla"); inoltre la serie di passi continua dallo snapshot, quindi cambiando sezione a metà serie il fattore si riferisce alla nuova sezione (comportamento coerente, ma la nota "+N" con audio si riferisce alla prima).
3. **Bassa, euristica**: finali di strofa con 1,1,1,3 o 1,1,5 battiti (tre accordi ravvicinati) e il primo accordo di sezione corto in 7 sezioni su 12 (esempio strofa 1: G 3 / D 1); la stima è sensibile a una sillaba (primo ritornello 2,2,6 contro 1,3,4 negli altri).
4. **Cosmetica**: spazio largo tra "♩" e "=" nel pulsante BPM; − / + da 40 px.

## C. Regressione

`npm test` 177/177; `round5.cjs all` ALL PASS; `round4.cjs` ALL PASSED; `round6.cjs` 0 FAIL; round4-tester-a 17 PASS; round4-tester-audio B1 (tutto il B3 MP3 incluso) ALL PASS; round4-tester-anchors senza errori (ancora conservata dopo il reload); round5-tester-core 0 FAIL. Non completata: la corsa intera di `round4-tester-audio.cjs` senza argomento supera i 10 minuti (non è un fallimento, solo troppo lunga).

## Non verificato

Touch su dispositivo reale (solo CDP); ascolto a orecchio della stima sul brano reale; ritmo UG con più di una battuta.
