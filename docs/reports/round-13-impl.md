# Round 13 — Report dell'implementatore

Tutti i numeri sono di Chromium (profili telefono di Playwright). Nessun testo del brano reale; screenshot solo in `test-artifacts/round-13/` (non versionati). Decisioni: `docs/DECISIONS.md`, «Round 13».

## Cosa è stato fatto
1. **Diagrammi di lato** (colonna sticky 72 px / 104 px da 560 px, nome sotto, corrente pieno, prossimo tratteggiato, scorre da sola; impostazione di lato/in cima/nascosti).
2. **Barra che si abbassa** (mini-barra 46 px dopo 4 s; riapre al tocco; non si chiude con menu, campi, avvisi o fogli aperti; impostazione).
3. **Tempo 25–100%** (percentuale + BPM, − / +, 50/75/100, pressione lunga, BPM obiettivo, salvato per brano, etichetta nella mini-barra).
4. Bug 4 del round 12 (diagnostica salvata all'uscita). Bug 5 non fatto (motivo nelle decisioni).
5. **Numeri delle dita: non fatto da me**: lo ha preso il coordinatore (`src/chords-db.js`, `src/diagram.js`; non li ho toccati).

## Schermate (descritte)
- `*-02-playing`: colonna a destra con l'accordo corrente pieno (arancio) e il prossimo tratteggiato; il testo va a capo in ~270 px a 375 px, ~215 px a 320 px; nessuno scorrimento orizzontale. In orizzontale (844×390) la colonna è 104 px e i diagrammi più grandi; l'ultimo è tagliato dalla barra (la colonna scorre).
- `*-03-mini`, `*-04-mini-playing`: mini-barra con Play/Pausa, «D › Am», tempo «0:12 / 2:02», ▲.
- `*-05-tempo`: riga «− [70% · ♩ 70 (di 100)] + 50 75 100» sotto la riga del BPM, entra a 320 px.
- `SE-06-real-50`: reale al 50%.

## Misure
- Layout (`test/e2e/round13.cjs`, 320, SE, 13, 13 orizzontale): 94 PASS, 0 FAIL. Colonna larga 72 px (svg 62 px) e 104 px in orizzontale; 12 diagrammi per 12 accordi, in ordine; dopo lo scorrimento resta sotto la barra alta e sopra la barra in basso; accordo acceso = accordo del pannello in 51/51 campioni, sempre dentro la colonna, prossimo marcato 51/51.
- Barra: chiusura a 3932 ms da fermo e ~4020 ms in play; altezza aperta 147 px (SE), ridotta 51 px; l'ultima riga della pagina sta sopra la barra; il menu aperto la tiene aperta 5 s.
- Reale al 50% (`round13-real.cjs`, SE, sezione 3, 141,4 BPM): media avanza 0,500 s/s; 28 tic in 24 s, intervallo mediano 847 ms (atteso 854 = 427/0,5), min 838, max 858; tic − battito sulla linea del file: mediana 0 ms, p90 3 ms; cambio di accordo evidenziato − inizio evento: mediana 4 ms, p90 8 ms.
- Cambi di velocità in play (75, 60, 100, 50, 25, 50): 27 tic, 26 consecutivi, 0 doppi, 0 persi. (Una prima misura vedeva un «doppio»: era un oscillatore già annullato e contato dal test; il test ora conta solo i tic che suonano. I due ritocchi al motore restano perché eliminano comunque la possibilità.)
- Audio non muto (RMS con analizzatore sul nodo dell'elemento, Chromium): 25% 0,199, 50% 0,160, 100% 0,139.
- Loop al 60%: velocità mantenuta dopo i giri, 6 salti, silenzio massimo 32–41 ms (limite 150), primo tic del giro a ±4 ms dal primo battito.
- Round 11 e 12 (SE): ALL PASS (con «Barra sempre aperta»). `npm test`: 292 pass.

## Cosa non funziona / limiti
- Bug 5 (tic che seguono «Evidenziazione») non fatto.
- A 25% la qualità di `preservesPitch` è quella del browser: sul telefono potrebbe suonare «metallica».
- Un dot dei diagrammi laterali è ~7 px a 72 px di colonna: per un numero dentro il cerchio (lavoro del coordinatore) serve ritagliare il viewBox di `renderDiagramSvg` sui soli tasti/corde, o ingrandire la colonna.

## Da controllare sul telefono (Firefox Android)
- `mozPreservesPitch`/`preservesPitch` a 50% e 25%: l'audio non si zittisce e il tono non cambia; il tempo avanza a metà.
- Tic e evidenziazione sugli attacchi al 50% (la latenza ora scala con la velocità).
- Colonna sticky: altezza giusta con la barra degli indirizzi che compare/scompare; scorrimento della colonna col dito senza muovere la pagina.
- Mini-barra: 4 s, riapertura al tocco, nessuna chiusura mentre si usa il menu ⋯.
