# Round 3 — Tester: trasposizione, capotasto, diagrammi, libreria (M5)

Leggi `CLAUDE.md`, `docs/SPEC.md` (Strumenti, milestone 5), `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md`, `docs/rounds/round-3-impl.md` e `docs/reports/round-3-impl.md`. Verifica in modo **indipendente e scettico**. Regole come ai round precedenti (non toccare `src/`, `scripts/`, test esistenti; tuoi file in `test/e2e/` e `test/regression/`; screenshot in `test-artifacts/round-3/` guardati davvero; nessun testo del brano reale nei file committati; niente push).

## A. Correzioni del round 2
1. Wake Lock: pausa prima della concessione → lock rilasciato (il tuo test di regressione passa senza `todo`).
2. Avviso schermo nel pannello, visibile durante il play.
3. "Sostituisci" con due copie: si sceglie quale.
4. Anteprima registrazione: durate sospette evidenziate quando salti un tocco.
5. Riga corrente al ~25% dell'altezza visibile sopra il pannello per tutto il play.
6. Pannello in play ≤ 120 px a 360 px; righe intere visibili su iPhone 13 a scala 1,5 ≥ 5; i comandi nascosti dietro "⋯" funzionano tutti.

## B. Trasposizione (calcoli tuoi)
1. Scrivi tu una tabella indipendente di trasposizione (non usare `transpose.js` per calcolare l'atteso) e confronta su almeno 300 casi: tutte le 12 radici (con diesis e bemolle) × qualità (maj, m, 7, m7, maj7, sus2, sus4, add9, dim, aug, m7b5, 6, 9) × slash, per ±1…±11.
2. Andata e ritorno ±12 sul file reale torna all'originale, sia nel modello sia nel DOM (criterio M5).
3. Ortografia: almeno questi casi in tonalità con bemolle: Sol +3 → Si♭ (non La#), Sol −2 → Fa con B♭ (non A#), Sol +8 → Mi♭. Controlla cosa mostra la UI per Re +4 → Fa# (diesis).
4. `estimateKey` sul file reale = Sol maggiore.
5. Trasposizione e colori: un accordo ha lo stesso colore prima e dopo la trasposizione.
6. Tutta la UI segue la trasposizione: testo, intestazione, pannello del player, foglio accordo, diagrammi.

## C. Capotasto
1. Transpose 0 → migliore capo 0. Transpose +2 → migliore capo 2 con forme G D Em Am C A. Calcola tu un terzo caso (es. transpose +3) e verifica che le 3 opzioni proposte siano sensate secondo la tabella di difficoltà del piano.
2. Vista forme: accordi mostrati = forme, intestazione "Capo N — forme", diagrammi delle forme.
3. Persistenza dopo reload.

## D. Diagrammi
1. Verifica musicale indipendente: per ogni forma del dizionario, calcola tu dalle corde (E A D G B E) le note suonate e controlla che appartengano all'accordo e che la fondamentale sia presente (per gli slash, che il basso più grave sia la nota del basso). Riporta quante forme passano e l'elenco di quelle sbagliate.
2. Copertura: tutte le 12 radici × (maj, m, 7, m7, maj7, sus2, sus4) hanno un diagramma; accordo inventato ("Xzz", "C13#11b9") → "diagramma non disponibile" senza errori.
3. Visivo: fila nell'intestazione (scorre dentro la fila, la pagina non scorre in orizzontale), diagramma grande nel foglio, diagrammi piccoli nel pannello. Leggibili in tema chiaro e scuro, numero del tasto leggibile. Guarda gli screenshot.

## E. Libreria
1. Ricerca: senza accenti e maiuscole; ordinamenti.
2. Export → svuota storage → import: brani identici (deep equal) inclusi durate, BPM per sezione, transpose, capo, view.
3. Import malformati: JSON rotto, versione sconosciuta, brano senza sezioni, file enorme → errori leggibili e libreria intatta.
4. Import con brani già presenti: le tre opzioni si comportano come descritto.
5. Indicatore di spazio usato plausibile (confrontalo con la somma delle lunghezze delle chiavi `gapp.*`).

## F. Regressioni
Rilancia i tuoi script e2e dei round 1 e 2 (parole spezzate, allineamento, precisione dei cambi, durate): devono passare ancora. Riporta i numeri.

## Report: `docs/reports/round-3-test.md`
Stesso formato dei round precedenti. Risposta finale di 15 righe al massimo.
