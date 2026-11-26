# Round 11 — Report dell'implementatore

Tic su una griglia continua, ritocco affidabile, tagli a inizio brano e a metà sezione, più l'aggiunta dell'utente (fine del Verse 1). Nessun testo del brano reale: solo conteggi, tempi, nomi di sezione. Decisioni in `docs/DECISIONS.md` ("Round 11"). I `todo` del tester sono test normali (`test/round10-tester*.test.js`); `test/regression/` rimossa. `npm test`: 274/274 (da 250).

## 1. Tic su una griglia continua

Reale intero, 8,5 minuti in play su SE con il clic acceso (`round10-tester-clicks.cjs` + `round11-clicks-analyse.mjs`):

| misura (reale, sezioni stabili) | round 10 | round 11 |
|---|---|---|
| intervalli tra tic oltre ±15% | 17% (125/737) | **0,0% (0/740)** |
| oltre ±25% / ±40% | 14 / 13 | 0 / 0 |
| tic a meno di 0,6 battiti dal precedente | 1 | **0** |
| errore del tic contro il battito della timeline | – | mediana 0,7 ms, max 3 ms |
| battiti senza clic / clic senza battito | – | 0 / 0 |
| sorelle: strofe da 36 accordi, tic totali | 4 sezioni, ±1 su 2 posizioni uguali | totali 132/133/133/132; 28 posizioni su 36 differiscono di ±1 (non forzate) |
| ritornelli da 16: totali | – | 42/43/42/44/45; 8 posizioni su 16 differiscono |
| ultimo tic / fine della musica | 508,23 / – | 506,54 / 507,03 (fine audio 513,6) |
| accenti | – | ogni 4 battiti della griglia (277–291 accenti), fase scelta per il maggior numero di inizi accordo su un primo tempo |

Sintetico (accordi da 1, 2, 3, 4, 8 quarti, 6 sezioni): tic esatti in 39 accordi stabili su 44 (gli altri 5 sono inizi d'accordo trovati dal motore in ritardo di mezzo battito o più; non sono tic sbagliati); errore dei tic mediana 7 ms, 90% 15 ms, oltre 30 ms: 1 su 155 (round 10: 10 su 155, mediana 10 ms); ultimo accordo 8 tic (prima 11–12). Perché: il motore anticipava tutti i tempi di 25 ms in meno del dovuto (inizi trovati 16–42 ms dopo l'attacco su tre banchi): ora sono spostati di −25 ms.

- Accenti: ogni `perBar` battiti della griglia dalla fase che mette più cambi d'accordo su un primo tempo (a pari merito, il primo tic della sezione).
- Tempo libero: tic accentato su ogni cambio, intermedi solo se l'accordo dura ≥ 2 battiti del tempo vicino, l'ultimo ad almeno 0,6 battiti dal cambio.
- Loop (`round10-tester-real.cjs SE loop`): 43,9 tic per giro contro 43 battiti, nessun intervallo fuori da 0,6–1,5 battiti (max 459 ms su 437): nessun tic perso al riavvolgimento.
- BPM del pannello = BPM misurato della schermata di sincronizzazione.
- Alla fine dell'audio: l'ultimo accordo finisce quando il suo suono scende al 30% dell'attacco.

## 2. Ritocco

- Tic e quarti si ricalcolano dalla griglia a ogni costruzione della timeline: dopo 40 ritocchi di −0,25 su un accordo (il precedente scende a 0,1 s) nessuna coppia di tic a meno di 0,6 battiti, ≤ 1 tic per accordo sotto 0,2 s (test).
- Gap: segue l'accordo dopo (si accorcia/allunga), sparisce solo sotto 3 s (test: +0,25 allunga di 0,25, −0,25 accorcia, 5 passi di sezione lo cancellano).
- ⇄ sull'intestazione di ogni sezione subito dopo la sincronizzazione e dopo il reload (`round11.cjs btn`: 6/6 e 6/6, SE; il bottone dipendeva dal giocatore audio già caricato).
- Pressione lunga (`round11.cjs press`, SE, 13, 320): sfiorando 3 px il foglio si apre; il rilascio non preme il pulsante sotto il dito (senza la guardia da 320 ms il test fallisce: 1 tempo cambiato); scorrere 30 px annulla; `user-select: none`, `-webkit-touch-callout: none`, niente menu contestuale.
- Suggerimento «Tieni premuto un accordo per spostarlo un po’ avanti o indietro»: la prima volta, una volta per dispositivo (`round11.cjs hint`).
- Ancore: il ritocco di una sezione ancorata sposta l'ancora della stessa quantità (test del tester, convertito).

## 3. Tagli (reale; `round11-realcut.mjs`)

| caso | round 10 | round 11 |
|---|---|---|
| senza i primi 60 s | `yssgygygggrr`, sezioni 2 e 3 «non presenti» a torto | `yyygygygggrr`, nessuna saltata, 3/293 eventi oltre 250 ms |
| senza i primi 30 s | ok | ok (`ryygygygggrr`) |
| senza 60 s e tagliato al 70% | verde sbagliato (sez. 2) | `yyygygyyysss`, 3/198 fuori |
| taglio al 20% | non riconosciuto, tutto rosso | riconosciuto, `yyysssssssss`, 1/59 fuori |
| taglio al 45% (a metà ritornello) | sez. 6 verde con 11/11 cambi 2,7–3,7 s in anticipo | sez. 6 e 5 gialle («sezione tagliata: parte dei cambi manca nell’audio»); la compressione c'è ancora (l'allineamento sposta il ritornello di un periodo di 4 accordi: stessi accordi), ma non è verde |
| 30, 50, 70, 80, 95% | ok | ok, la sezione tagliata è gialla (non più verde) |
| una o due sezioni tolte | invariati | invariati (colori `rysgygygygry`… identici, nessun verde sbagliato) |

Sintetico, 35 tagli × 5 semi: 0 verdi sbagliati, 0 saltate a torto (verdi 155 → 120: le sezioni parziali non sono più verdi). Salto di testa: 8 per evento (con 5 il taglio al 30% leggeva «salta le sezioni 1–6»).

## 4. Il resto

- Strofe uguali: la riga «non presente» dice «una delle strofe manca: se è un’altra, usa ⇄ o Correggi a orecchio». Non scelgo la mancante per ordine del testo (l'audio non la distingue).
- «Cambio!» a 320×568: tutto sopra la barra (y 188–338, barra da 465; `round11.cjs corr`).
- «1 sezione», «1 sicura», «1 incerta», «Esportata 1 sezione».
- Prestazioni (CPU ×4, SE, 3 corse, stessa sessione): round 10 totale 11,8–11,9 s, frame più lungo 92/116/120 ms; round 11 12,4–13,5 s, 123–146 ms. Il ciclo del Viterbi è tornato alla velocità di prima (Node 1,8–2,0 s uguale), la timeline costa 0,2 ms. Il di più è il disegno della schermata di sincronizzazione (~80 ms a ×4) e la parte fredda del JIT: **non tornato al livello del round 9**.

## 5. Aggiunta dell'utente: fine del Verse 1 e Chorus 1

Il «gap» 59,3–63,5 s era il G tenuto dell'evento 34 che decade nel silenzio. Un gap il cui croma somiglia di più all'accordo prima che a ogni altro del foglio, o la cui energia è sotto l'8% dell'attacco, non è un gap: l'accordo dura. Il reale ora non ha gap (resta quello dell'assolo sintetico di 20 s: trovato a 0,1 s, `round9-tester-engine missing`). Nel tempo libero, senza nessun attacco nella finestra, si usa la prima salita sostenuta del croma del nuovo accordo.

| evento (0-based) | accordo | round 10 | round 11 | audio (coordinatore) |
|---|---|---|---|---|
| 30 | D | 49,64 | 49,62 | ~49,9 |
| 31 | Em | 50,57 | 50,55 | ~50,7–51,4 |
| 32 | C | 53,73 | **53,05** | ~53,1–53,2 |
| 33 | D | 55,19 | 55,17 | ~55,2 |
| 34 | G | 57,91, fine 59,30 | 57,89, **fine 63,43** | 58,0, suona fino a ~63,0 |
| gap | – | 59,30–63,46 | **nessuno** | – |
| 35 | G (Chorus) | 63,46 | 63,43 | attacco ~63,1–63,4 |

Test (`test/round11-real-verse1.test.js`, saltato senza fixture): nessun gap, evento 34 finisce dopo 62,5 s, evento 32 in 53,0–53,5, evento 35 in 62,9–63,6. Il controllo indipendente locale (croma 59,3–63,4: G 0,87 contro D 0,57, energia 18% dell'attacco) è nello script `test-artifacts/round-11/gap.mjs` (non versionato). Il punto 2 del compito (attacco dopo pausa lunga) non ha richiesto codice: l'evento 35 è già a 63,43. La salita del croma sposta anche l'evento 306 di −0,65 s (non verificato in modo indipendente).

## Regressione

`npm test` 274/274. E2E: `round10.cjs all SE` 0 FAIL dopo aver tolto i controlli sul gap reale (T9, G0); `round11.cjs` btn/hint/press SE, 13, 320 e corr: tutto PASS; `round10-tester-real.cjs SE loop` PASS; `round9-tester-engine cut` e `missing`: 0 verdi sbagliati, 0 saltate a torto, sezioni mancanti e assolo riconosciuti. Non rieseguiti: la lista completa di `round10-regress.sh` (oltre 25 minuti: restano da rifare gli script dei round 4–9 che non toccano tic, ritocco, tagli o gap) e `round10-tester-*` diversi da clicks e loop.

## Cosa non funziona

- Taglio a metà sezione: la compressione dell'allineamento (ripetizione di 4 accordi) non è corretta, solo segnalata (giallo).
- Sorelle: 28 posizioni su 36 differiscono di ±1 tic (i cambi del motore, ±0,6 battiti); non forzate come richiesto.
- Frame più lungo nel browser 20–25% sopra il round 10.
- Non verificato su un dito vero iOS: la guardia del rilascio e la soglia di 12 px; non verificato che i tic cadano sui battiti veri del brano (il tester non ha un metodo indipendente).
- Il suono del G tenuto nel tempo libero ha ora circa 12 tic fino al Chorus.
