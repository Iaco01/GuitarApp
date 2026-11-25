# Round 6 — Report dell'implementatore

## Cosa è stato fatto

1. **Durate stimate dalla posizione degli accordi** (`src/durations.js`, puro): `countSyllables`, `syllableMap`, `estimateSectionDurations`, `estimateSongDurations`. Il file `.mht` non contiene durate; l'unica informazione è la sillaba sotto cui cade ogni accordo. Algoritmo: posizione di ogni accordo nel flusso di sillabe della sezione, durata in sillabe = distanza dal successivo, un solo fattore di sezione (battiti per sillaba) per avere la media richiesta (default 4), arrotondamento delle posizioni cumulative a griglia 2 (griglia 1 e minimo 1 nei cambi rapidi), totale di sezione a multiplo di battuta.
2. **Integrazione**: l'import stima subito (`timingSource: 'estimated'`); schema 3 con migrazione dei brani `default` (gli `edited`/`recorded` non si toccano); impostazioni "Durate" = "Stimate dal testo" / "Fisse" con 2/4/8; avviso in modalità modifica.
3. **BPM − / + nel pannello** (seconda riga), pressione prolungata 5/s, tocco sul numero = campo + tap tempo + interruttore ambito ("Tutto il brano" in proporzione, "Solo questa sezione"), ricordato per brano. Nessun salto di posizione (riancoraggio al battito frazionario, clic già programmati annullati). Con l'audio: nota "+N BPM su tutto il brano" e "Annulla".

## Risultati sul file reale (328 accordi, 12 sezioni)

- Ogni sezione ha totale multiplo di 4, nessuna durata < 1, media per sezione = 4,00 (140/35 nella prima strofa, 64/16 nel primo ritornello). Valori presenti: 1, 2, 3, 4, 5, 6, 8, 10 (8 valori distinti). Totale 1312 battiti, come prima, perché la media è 4.
- Ritornelli con lo stesso testo e gli stessi accordi: durate identiche (test).
- Tempo di stima dell'intero brano: 3–6 ms (limite 20 ms).

Tabella per la prima strofa e il primo ritornello. "Sillabe" = sillabe assegnate all'accordo (dal suo inizio all'accordo successivo; il primo accordo include quelle cantate prima, l'ultimo quelle rimaste fino a fine sezione).


### Verse 1 (35 chords, 112 syllables, 140 beats)

| # | Chord | Syllables | Beats |
|---|---|---|---|
| 1 | G | 2 | 3 |
| 2 | D | 1 | 1 |
| 3 | Em | 3 | 4 |
| 4 | Am | 4 | 4 |
| 5 | C | 5 | 6 |
| 6 | Em | 6 | 8 |
| 7 | D | 3 | 4 |
| 8 | G | 2 | 2 |
| 9 | D | 2 | 4 |
| 10 | Em | 4 | 4 |
| 11 | Am | 4 | 6 |
| 12 | C | 4 | 4 |
| 13 | Em | 3 | 4 |
| 14 | C | 4 | 4 |
| 15 | D | 3 | 4 |
| 16 | Em | 3 | 4 |
| 17 | Am | 4 | 6 |
| 18 | Em | 6 | 6 |
| 19 | Am | 4 | 6 |
| 20 | C | 2 | 2 |
| 21 | G | 2 | 2 |
| 22 | Am | 3 | 4 |
| 23 | C | 4 | 6 |
| 24 | D | 2 | 2 |
| 25 | G | 3 | 4 |
| 26 | D | 3 | 4 |
| 27 | Em | 3 | 4 |
| 28 | Am | 4 | 4 |
| 29 | D | 4 | 6 |
| 30 | G | 3 | 4 |
| 31 | D | 3 | 2 |
| 32 | Em | 4 | 6 |
| 33 | C | 2 | 2 |
| 34 | D | 2 | 2 |
| 35 | G | 1 | 2 |

### Chorus (16 chords, 53 syllables, 64 beats)

| # | Chord | Syllables | Beats |
|---|---|---|---|
| 1 | G | 2 | 2 |
| 2 | C | 2 | 2 |
| 3 | G | 4 | 6 |
| 4 | D | 3 | 4 |
| 5 | G | 4 | 4 |
| 6 | C | 4 | 4 |
| 7 | G | 3 | 4 |
| 8 | D | 3 | 4 |
| 9 | G | 2 | 2 |
| 10 | C | 4 | 6 |
| 11 | G | 3 | 4 |
| 12 | D | 3 | 2 |
| 13 | Em | 7 | 10 |
| 14 | A | 1 | 2 |
| 15 | Em | 7 | 6 |
| 16 | D | 1 | 2 |

## Limiti dell'euristica

- Le sillabe sono contate con gruppi vocalici: errori su dittonghi/iati ("ia", "io"), parole con "-ed", "-es" e sigle; per l'italiano le parole che finiscono in "-e" perdono una sillaba (regola della "e" muta inglese). Una parola è divisa in parti uguali tra le sue sillabe, quindi un accordo a metà parola è approssimato.
- Non si sa dove cadono le battute: la durata è proporzionale alla distanza, non "musicale". Pause lunghe cantate (note tenute) risultano brevi, versi veloci risultano lunghi. Per questo il primo accordo di una sezione con attacco anticipato può uscire corto (nella prima strofa: G 3 battiti, D 1) e va corretto a mano.
- Con tre accordi ravvicinati la griglia è da 1 battito: possono uscire durate dispari (1, 3, 5), che a volte sono giuste e a volte rumore.
- La media per sezione è sempre 4 (o il valore scelto): una sezione parlata in fretta con pochi accordi e una lenta con molti hanno la stessa durata media.
- L'esempio del compito (0, 8, 12 su 16 sillabe → 8,4,4) con questo algoritmo dà 6,4,2: vedi DECISIONS, "Round 6".
- Il ritmo UG è una sola battuta per sezione, quindi non si ricava nulla da lì.

## Verifica

- `npm test`: 177 test, tutti verdi (nuovi: `test/durations.test.js` 12, `test/bpm.test.js` 5; modificati: parser e modello, vedi sotto).
- `npm run build` ok (31 moduli, 258 KB).
- Playwright (`test/e2e/round6.cjs`, 360 px, iPhone SE, iPhone 13):
  - file reale, 360 px: durate stimate e non tutte uguali (E1), avviso in modifica (E2), impostazioni (E3); premendo + cinque volte durante il play l'avanzamento in battiti tra prima e dopo ogni pressione è uguale al tempo trascorso (0,04–0,06 contro 0,04–0,05 attesi, nessun evento saltato); i cambi di accordo successivi arrivano col nuovo tempo (scarto massimo 15 ms rispetto alla timeline); − abbassa di 1; pressione lunga di 1,45 s = +6 BPM; ambito "Sez." cambia solo la sezione corrente; campo numerico; salvataggio immediato con `bpmSource: 'edited'` e valori conservati dopo il reload;
  - audio sintetico, iPhone SE: cinque + durante il play, l'audio non viene mai spostato (scarto ≤ 1 ms), resta in play, nota "+5 BPM su tutto il brano" e "Annulla" ripristina tutti i valori;
  - altezza del pannello in play: 0 px di differenza rispetto alla v1 su 360 px (112,5), iPhone SE (99) e iPhone 13 (99); nessun pulsante fuori dallo schermo.
- Regressioni: `round5.cjs all` 67 PASS 0 FAIL; `round4.cjs` ALL PASSED (S1–S11, 0 FAIL).
- Screenshot guardati: `test-artifacts/round-6/360-play-panel.png`, `360-edit-durations.png`, `SE-audio-note.png` (non versionati).

## Test esistenti modificati

- `test/parser.test.js`: le fixture sintetiche non hanno più `beats === 4` per tutti, ma interi ≥ 1 con totale di sezione multiplo di 4, e `timingSource` è `'estimated'` (l'import stima).
- `test/model.test.js`: `schemaVersion` 3.
- `test/timeline.test.js`: asserzioni su 328 accordi e 1312 battiti invariate (media 4 per sezione); aggiunto un commento sul perché.
- Nessun test indebolito; non è stato necessario fissare durate a 4.

## Non verificato / limiti

- Pressione prolungata su touch vero (verificata con mouse in Chromium); `touch-action` impostato.
- A 360 px il ritmo (frecce) nel pannello si riduce a 19 px (da 102): non c'è spazio con − / +. Il testo rimane nella seconda riga, non nella principale (vedi DECISIONS).
- Stima delle durate non confrontata con una registrazione a orecchio del brano reale.
- "Applica a tutte le sezioni con lo stesso nome" dal campo del pannello non implementato.
