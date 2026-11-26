# Round 11 — Report del tester

Verifica indipendente del round 11: tic sulla griglia dei battiti (A), fine del Verse 1 e spostamenti collaterali (B), ritocco (C), tagli, regressione, prestazioni e prova da utente (D). Nessun testo del brano reale è riportato: solo conteggi, tempi, nomi di sezione e di accordi. Gli screenshot (mostrano il testo) sono in `test-artifacts/round-11/` e non sono versionati.

Il reale è `test/fixtures/local/american-pie.{mht,mp3}`: 513,6 s, 12 sezioni, 328 accordi. Il «round 10» di confronto è `0149be1` in un worktree temporaneo (`git worktree add /tmp/r10wt 0149be1`, poi rimosso).

**Metodo indipendente.** Non ho usato il motore dell'app né la sua griglia per giudicare i tic e gli attacchi: `round11-tester-indep.py` (solo numpy) decodifica l'mp3 a 22,05 kHz, fa una STFT propria, un cromagramma pieno (100–2000 Hz) e uno dei bassi (41–200 Hz), e una curva di «forza dell'attacco» (flusso logaritmico a mezze onde in tre bande: 60–250, 250–2000, 2–8 kHz, normalizzato su 4 s). Gli istanti sono corretti per il centro della finestra (altrimenti tutti i risultati hanno un ritardo di 90–190 ms). Limite: la mia curva d'attacco ha una latenza propria di circa ±20 ms, per cui giudico bene i confronti relativi (round 10 contro round 11) e meno gli assoluti.

| file (tutti in `test/e2e/`) | contenuto |
|---|---|
| `round11-tester-indep.py`, `-trace.py`, `-verse1.py` | analisi audio propria, traccia frame per frame (punteggi di accordo, nota di basso, attacco), eventi 28–40 e altri |
| `round11-tester-vs-r10.mjs` | tutti i 328 eventi, motore del round 10 contro quello attuale, scritti in `test-artifacts/round-11/vs-r10.json` |
| `round11-tester-clicks.cjs` | copia di `round10-tester-clicks.cjs` che scrive in `round-11` (reale intero in play su SE con il clic acceso, anche `synth`) |
| `round11-tester-clicks-phase.py`, `-clicks-sections.py` | A2: fase dei tic contro gli attacchi veri (finestre di 12 s con pettine, distanza dall'attacco più vicino, per sezione, tic sui cambi contro tic intermedi) |
| `round11-tester-clicks-analyse.mjs`, `-analyse2.mjs`, `-clicks-synth-analyse.mjs` | copie delle analisi del round 10 e dell'implementatore che leggono `round-11` |
| `round11-tester-gaps.mjs` | B3: sintetico con assolo di 20 s su altri accordi / vamp sullo stesso accordo / un solo colpo che decade / senza batteria, sezione ripetuta, intro estranea |
| `round11-tester-realcut.mjs`, `-engine-seeds.mjs` | C1: copia del mio `round10-tester-realcut` con i tempi dei gap; tagli e sezioni mancanti sintetici con altri cinque semi |
| `round11-tester-nudge.cjs` (`btn`, `jitter`, `ticks`, `hint`, `gap`, `rowtap`, `anchor`), `round11-tester-nudge10-slow.cjs` | C: ritocco; il secondo è il mio `round10-tester-nudge` con una pausa di 450 ms dopo l'apertura del foglio |
| `round11-tester-real.cjs` (`verse1`, `user`, …) | copia di `round10-tester-real.cjs` con la modalità `verse1` (play 55–67 s con il pannello campionato ogni 80 ms) |
| `test/regression/round11-tester-real.test.js` | 2 test sul reale (1 `todo` per il bug 1, 1 verde); non fanno parte del glob di `npm test` (`node --test "test/regression/*.test.js"`) |

## Esito

| Punto | Esito |
|---|---|
| A1 tic, reale intero (SE, 1084 tic) | **regolari**: 742 intervalli nelle sezioni stabili, 2 (0,3%) oltre ±15% (round 10: 17%), 0 tic a meno di 0,6 battiti dal precedente, errore contro il battito della timeline mediana 0,7 ms (max 3), 0 battiti senza tic / 0 tic senza battito, 292 accenti tutti su un primo tempo della timeline, ultimo tic 506,5 s (fine musica 507,0). 315/327 accordi con tic uditi = tic della timeline; i 12 diversi sono battiti a meno di 40 ms dal confine di un accordo (arrotondamento della mia finestra) |
| A2 fase dei tic sui battiti veri (metodo mio) | **sezioni stabili (9 su 12, 330 s): in fase.** Finestre di 12 s col pettine: spostamento necessario mediana −12 ms (i tic sono ~12 ms dopo l'attacco), p90 17 ms, 40/42 finestre sotto 60 ms (2 finestre di Verse 4: 208 ms ≈ mezzo battito, il pettine è ambiguo ma la distanza mediana tic–attacco è 16 ms). Tic–attacco più vicino: mediana 10 ms, p90 29 ms. **Sezioni a tempo libero (Verse 1, Verse 6, Chorus 12 = 183 s = 36% del brano): i tic intermedi non sono sui battiti** (bug 2) |
| A3 spostamento globale −25 ms | **giusto**. Reale: inizio degli accordi contro il mio picco d'attacco, mediana 33 → 9 ms, mediana assoluta 37 → 14 ms, p90 57 → 45 ms (264 eventi con un attacco entro 120 ms). Sintetico: errore dei tic mediana 6 ms (round 10: 10), 90% 13 (25), massimo 34 (219), oltre 30 ms: 1/155 (10/155). Non peggiora nulla di misurabile |
| A4 tempo libero | tic accentato su ogni cambio (tutti tranne uno per sezione hanno un tic entro 30 ms), intermedi a distanza di battito della sezione vicina; **non sui battiti veri** (bug 2). Descrizione e misure in A4 |
| B1 eventi 28–40 (fine Verse 1, Chorus 1) | **nessun gap** (timeline vuota, pannello campionato ogni 80 ms da 55 a 67 s: 0 volte «Fuori dal foglio», SE e 13). Evento 32 (C): 53,05, sull'attacco (52,96) e sulla salita del croma/basso di C (53,0–53,2); evento 34 (G) 57,89 sull'attacco, evento 35 (Chorus) 63,43 sull'attacco (63,44). Tabella in B1 |
| B2 tutti i 328 eventi, round 10 contro round 11 | 287 spostati 20–30 ms (il −25 ms globale), **3 oltre 80 ms: 32 (−0,68 s, migliora), 69 (−0,11 s, neutro: sta su un attacco), 306 (−0,68 s, PEGGIORA: regressione confermata, bug 1)**. Oltre 0,25 s: 2 eventi, 1 miglioramento, 1 peggioramento |
| B3 gap veri sintetici | assolo di 20 s su altri accordi: trovato a ±0,1 s in 20/20 prove (5+3 semi); sezione ripetuta: trovata; intro estranea: nessun gap, primo accordo a 0,01–0,02 s. **Assolo tenuto sullo stesso accordo dell'ultimo del foglio (vamp o colpo che decade): nessun gap, la sezione sostituita esce rossa** (bug 6, voluto) |
| C ritocco SE, 13, 320 | ⇄ in tutte le intestazioni dopo la sincronizzazione, dopo 2 reload, dopo la riapertura (6/6 su 3 profili); tremolio 5, 8, 10 px apre il foglio e il rilascio (100 ms dopo l'apertura) non preme nulla; 13 px annulla; il gap segue l'accordo dopo (+0,25 −0,25 −0,25: fine del gap = inizio dell'accordo, 0 ms di scarto); suggerimento una volta sola (sincronizzazione + 3 reload: 1, 0, 0, 0); **ma**: rilascio oltre ~330 ms dopo l'apertura preme il pulsante (bug 3), tap veloci scartati (bug 4), ancore (bug 5), 3+1 pulsanti a 320 (bug 7) |
| D1 tagli | reale: 20/30/45/70% e −60 s (+ tagli) **0 verdi sbagliati** (round 10: 5 casi con verdi sbagliati), 0 saltate a torto; sintetico 35 tagli × 5 semi nuovi: 0 verdi sbagliati, 0 saltate a torto |
| D2 regressione | `npm test` **274/274** (58 s); `round10-regress.sh` completo: vedi D2; e2e del round 10: vedi D2 |
| D3 CPU ×4 | **nessuna differenza**: alternati round 10 / round 11 / round 10 / round 11, 2 corse ciascuno: frame più lungo 120/109/108/126 ms (media 116) contro 118/113/115/111 (media 114); totale 12,8 contro 12,3 s. I 123–146 ms dell'implementatore sono rumore di macchina (D3) |
| D4 prova da utente SE e 13 | completata, nessun blocco; esitazioni in D4 |

## A. Tic

### A1. Reale intero, SE, clic acceso (`round11-tester-clicks.cjs SE`, `round11-tester-clicks-analyse*.mjs`)

| misura (sezioni stabili) | round 10 (mio report) | round 11 (mia corsa) |
|---|---|---|
| intervalli oltre ±15% del battito | 17% | **0,3% (2/742)** |
| oltre ±25% / ±40% | 14 / 13 | 2 / 1 |
| tic a meno di 0,6 battiti dal precedente | 1 | 0 |
| errore contro il battito della timeline | – | mediana 0,7 ms, p90 1,3, max 3 |
| accordi con tic uditi = tic della timeline | 327/328 | 315/327 (12 a ±40 ms dal confine: battito attribuito all'accordo vicino) |
| accenti | 278 | 292, tutti su un primo tempo della timeline; ogni 4 tic in tutte le sezioni stabili (tutti gli intervalli fra accenti sono 4: 10 per ritornello, 32 per strofa) |
| ultimo tic / fine della musica | 508,2 | 506,5 / 507,0 |

Tic nel loop: `round11-tester-real.cjs` non ripete `loop`; il risultato dell'implementatore (43,9 tic per giro contro 43 battiti) non l'ho rifatto (non verificato). Un limite di lettura che non è un difetto: il **45% degli accordi stabili ha una lunghezza a più di 0,25 quarti da un numero intero** (101/224) e il 29% è di 3, 5 o 7 quarti; con la griglia continua gli inizi degli accordi cadono a ½ battito dal battito più vicino nel 34% dei casi (77/224: 47 in anticipo, 30 in ritardo di ½ battito), nel 60% entro 0,1 battito. Sono anticipazioni musicali (il mio attacco c'è, p. es. mediana 14 ms), non errori; ma significa che il tic non cade sul cambio d'accordo in un terzo degli accordi.

### A2. Fase dei tic sui battiti veri (metodo indipendente)

Due misure, entrambe sul mio flusso spettrale (nessun uso dell'app):

1. **Tic → attacco più vicino** (picchi di forza > 5), per sezione: percentuale dei tic entro 40 ms e distanza mediana, con il controllo «gli stessi tic spostati di mezzo battito».

| sezione | tempo (BPM) | tipo | tic | entro 40 ms | distanza mediana | controllo (+½ battito) entro 40 ms |
|---|---|---|---|---|---|---|
| 1 Verse 1 | 100,9 | **libera** | 96 | 26% | **142 ms** | 21% |
| 2 Chorus | 100,9 | stabile | 42 | 50% | 43 ms | 24% |
| 3 Verse 2 | 141,4 | stabile | 132 | 82% | 15 ms | 51% |
| 4 Chorus | 137,2 | stabile | 44 | 70% | 17 ms | 52% |
| 5 Verse 3 | 138,0 | stabile | 132 | 70% | 20 ms | 64% |
| 6 Chorus | 136,2 | stabile | 43 | 63% | 25 ms | 37% |
| 7 Verse 4 | 138,2 | stabile | 133 | 68% | 16 ms | 59% |
| 8 Chorus | 136,6 | stabile | 44 | 77% | 11 ms | 32% |
| 9 Verse 5 | 138,5 | stabile | 132 | 76% | 17 ms | 59% |
| 10 Chorus | 135,9 | stabile | 45 | 58% | 19 ms | 18% |
| 11 Verse 6 | 135,9 | **libera** | 137 | 22% | **118 ms** | 18% |
| 12 Chorus | 135,9 | **libera** | 104 | 24% | **126 ms** | 20% |

Nelle strofe stabili il controllo a mezzo battito è poco selettivo (gli attacchi sono fitti, ottavi di chitarra): per questo la seconda misura.

2. **Pettine su finestre di 12 s** (sezioni stabili, passo 6 s, 42 finestre): per ogni finestra, il punteggio medio della curva d'attacco sui tic spostati di d ∈ ±½ battito; d al massimo = scarto dei tic dal battito vero. Mediana **−12 ms**, p90 17 ms, 40/42 finestre sotto 60 ms (per sezione: mediane −5…−15 ms). Cioè i tic cadono ~10–12 ms dopo l'attacco: ben sotto la soglia percepibile (~30 ms). Le due finestre di Verse 4 (247–265 s) scelgono +208 ms (≈ mezzo battito, 217 ms): lì la distanza mediana tic–attacco è 16 ms, ma il controllo a mezzo battito dà 74% contro 62% (il retrobeat è forte): **ambiguo, non lo conto come errore**.

**Conclusione A2.** Nelle 9 sezioni stabili i tic sono sui battiti veri (scarto ~10 ms, p90 ~30 ms): la correzione richiesta dall'utente funziona per 330 s su 513. Nelle 3 sezioni a tempo libero **il 36% del brano** è fuori fase (bug 2). Il Chorus 1 (sezione 2, stabile a 100,9 BPM, mentre gli altri ritornelli sono a 136–137) è la più debole delle stabili (50% entro 40 ms, mediana 43 ms contro 11–25 ms): non è sbagliata (pettine −15 ms) ma meno netta; l'autocorrelazione che ho provato non decide il tempo vero (non lo conto).

### A3. Lo spostamento globale di −25 ms

È giusto, sul reale e sul sintetico (numeri nella tabella «Esito»). Reale: le mediane contro i picchi d'attacco passano da +33 a +9 ms (mediana assoluta 37 → 14 ms): ora gli inizi stanno sull'attacco entro il limite della mia misura. Sul reale non c'è un evento che lo spostamento peggiori: 287 eventi si spostano di 20–30 ms e tutti e soli i 3 che si spostano di più sono l'effetto della seconda correzione (B2).

### A4. Tempo libero: come suona adesso

Sezioni 1, 11, 12 (Verse 1, Verse 6, Chorus 12: 35 + 36 + 33 accordi, 96 + 137 + 104 = 337 tic). Cosa si sente:

- un tic **accentato su ogni cambio d'accordo**: tutti i cambi tranne uno per sezione hanno un tic entro 30 ms, e di quei tic il 53%, 64%, 53% sta entro 40 ms da un mio attacco (i cambi sono dove il motore ha trovato l'attacco);
- **tic intermedi** (62 + 101 + 72) a distanza uguale al battito della sezione vicina (100,9 per Verse 1, che prende il tempo del Chorus 1; 135,9 per le altre due), solo negli accordi di almeno 2 battiti, l'ultimo a ≥ 0,6 battiti dal cambio. **Solo il 11%, 7% e 11% sta entro 40 ms da un mio attacco** (a caso: ~20%), distanza mediana 244, 160, 141 ms: sono tic «di conta» regolari che non seguono il battito del brano; intervalli fra tic: 5–95% 0,81–1,55 battiti, 67 di 338 intervalli oltre ±25% (nelle stabili: 2 su 742);
- il conto dei tic per accordo è coerente con la timeline e con contatore e punti; i tic non raddoppiano ai confini.

Per l'orecchio: nelle sezioni libere il clic segna bene i cambi e poi «cammina» a un passo suo; è la parte di strofa che l'utente probabilmente sente «fuori». Nel sintetico (sezione libera di 15,3 s, 6 accordi di 1,40/1,66/3,57/3,12/3,00/2,57 s): 23 tic, tic per accordo 2/2/5/5/5/4, spaziatura mediana 651 ms (min 481, max 970).

## B. Fine del Verse 1 e spostamenti collaterali

### B1. Eventi 28–40 sul reale (metodo mio)

Per ogni evento: il tempo del round 10 e del round 11, lo scarto del round 11 dal picco d'attacco più vicino (forza fra parentesi) e dal punto di cambio del cromagramma (miglior taglio fra l'accordo prima e l'accordo dopo in una finestra di ±0,6 s). Il cambio nel basso, con la mia FFT da 8192 punti, è inaffidabile (note di passaggio, mediana 0,5 s): non lo riporto in tabella; dove serve lo cito nel testo.

| evento | accordo | round 10 | round 11 | da attacco (forza) | da cambio croma |
|---|---|---|---|---|---|
| 28 | D | 46,63 | 46,60 | +0,11 (8) | +0,07 |
| 29 | G | 48,74 | 48,71 | +0,02 (15) | +0,02 |
| 30 | D | 49,64 | 49,62 | 0,00 (11) | +0,07 |
| 31 | Em | 50,57 | 50,55 | +0,05 (6) | −0,23 (Em e D condividono note) |
| 32 | C | 53,73 | **53,05** | −0,08 (6) | non decidibile (Em e C condividono E e G) |
| 33 | D | 55,19 | 55,17 | +0,02 (15) | +0,07 |
| 34 | G | 57,91 | 57,89 | 0,00 (6) | −0,21 |
| 35 | G (Chorus) | 63,46 | 63,43 | −0,01 (11) | stesso accordo del 34: non misurabile |
| 36 | C | 64,25 | 64,22 | −0,01 (5) | −0,45 (passaggio) |
| 37 | G | 65,43 | 65,41 | +0,16 (6) | +0,09 |
| 38 | D | 66,83 | 66,80 | −0,03 (8) | +0,09 |
| 39 | G | 68,03 | 68,01 | nessun attacco forte entro ±0,28 | −0,56 (arpeggio) |
| 40 | C | 69,24 | 69,22 | nessun attacco forte entro ±0,28 | 0,00 |

- **Evento 32 (C)**: il mio flusso ha un attacco a 52,96 (forza 6) e il basso C sale da 0,30 a 0,76 (normalizzato) fra 52,8 e 53,0, il croma C da 0,00 a 0,41–0,65 fra 52,8 e 53,2; fra 53,3 e 54,3 non c'è nessun attacco sopra 4,6. Il round 10 (53,73) cadeva 0,7 s dopo l'attacco, in un tratto senza attacchi: **migliora** (53,05 contro attacco 52,96). Nota: un taglio a due accordi (Em/C) mette il cambio a 54,1–54,3 perché i due accordi condividono E e G e la nota E del basso resta fino a ~54,2: l'ascolto «C solo da ~54,4» del coordinatore corrisponde alla fine della nota E, non all'attacco.
- **Eventi 34 e 35**: il G dell'evento 34 attacca a 57,89 (picco 57,89, forza 6; 58,00 forza 11) e dura fino al Chorus; nessun picco forte fra 58,3 e 63,0 (l'energia decade); l'attacco del Chorus è a 63,11–63,44 (tre picchi 9–11): l'evento 35 (63,43) sta sull'ultimo. Il motore non vede il G tenuto come gap: giusto.
- **«Fuori dal foglio» nell'app**: `round11-tester-real.cjs SE verse1` e `13 verse1`: gap della timeline `[]`; pannello campionato ogni 80 ms da 55,0 a 67,0 s: 0 campioni con «Fuori dal foglio» o con il gap acceso; sequenza dei nomi nel pannello `C 55,07 | D 55,24 | G 57,90 | C 64,23 | G 65,48 | D 66,82 | G 68,06` (il G del Chorus 1 non cambia il nome perché è lo stesso accordo del 34; il cambio si vede nell'evidenziazione del foglio).
- Eventi 39 e 40: nessun attacco forte nella finestra (cambio morbido): non valutabili in modo indipendente; il round 11 li ha spostati solo di −0,02 s.

### B2. Tutti i 328 eventi, round 10 contro round 11 (`round11-tester-vs-r10.mjs`)

- Colori delle sezioni identici (`rgygygygggry`), gap 1 → 0, sezioni saltate 0 → 0.
- Spostati di più di 20 ms: 287; di più di 100 ms: 3; di più di 250 ms: **2** (non 1: il coordinatore ha trovato il 306, l'altro è il 32).
- **Per ogni evento spostato di più di 0,25 s**:

| evento | accordo | round 10 | round 11 | mio controllo | giudizio |
|---|---|---|---|---|---|
| 32 | C (Verse 1) | 53,73 | 53,05 | attacco 52,96, salita di C nel basso e nel croma a 53,0–53,2 | **migliora** (|scarto| 0,77 → 0,09 s dall'attacco) |
| 306 | D (Verse 6) | 473,83 | 473,15 | attacco a 473,80 (forza 6), il croma di G collassa a 473,85–473,90 (G 0,58 → 0,34 → −0,01 fra 473,8 e 473,9, D 0,37 → 0,43 → 0,33), il basso F#/D sale da 473,2 a 474,0–474,4; il G dura 3,2 battiti nel round 10 e 1,65 nel round 11 (gli altri G della sezione 3–4 battiti) | **peggiora** (|scarto| 0,03 → 0,65 s dall'attacco) |

Conteggio: **1 miglioramento, 1 peggioramento**. Fra 0,08 e 0,25 s c'è un solo altro evento: il 69 (D → C, Verse 2) 120,69 → 120,58 (−0,11 s): il 120,58 coincide con un attacco (120,58, forza 7; l'altro a 120,86 forza 10): neutro/ambiguo.

**Causa del 306** (da `git diff 0149be1 HEAD -- src/analysis/refine.js`): la nuova `chromaLead` si applica quando non c'è «nessun attacco compatibile» e prende il primo istante in cui il croma somiglia più al nuovo accordo che al vecchio di 0,1 per 0,3 s. Il 306 è un G → D: il G contiene D e nel passaggio del basso (F#, A) il croma di D supera quello di G già a 473,2–473,5 (D 0,37–0,52 contro G 0,27–0,43 nella mia traccia), 0,6 s prima del vero cambio. La regola vale per ogni cambio fra accordi con note comuni (G/D, D/Em, C/Em): di qui la sua fragilità. L'evento 32 (Em → C) è l'altro caso in cui scatta, e lì è giusta perché l'attacco c'è. Test `todo`: `test/regression/round11-tester-real.test.js` (evento 306 entro 0,3 s da 473,83).

### B3. Gap veri (`round11-tester-gaps.mjs`, tre semi nuovi 211/223/239, + `round9-tester-engine all`, 5 semi, + 5 semi miei 311–359)

| caso | risultato |
|---|---|
| assolo di 20 s su altri accordi al posto della sezione 6 | gap trovato a 0,0–0,1 s dal vero in 13/13 prove (3 + 5 + 5 semi), sezione saltata («non presente») |
| sezione ripetuta (Chorus due volte) | gap trovato (65,4–81,2 s, ripetizione di 18,9 s): corretto |
| intro estranea di 9,6 s (e 5/15/30 s del banco r9) | nessun gap, primo accordo a 0,00–0,02 s dal vero, sezione 1 verde |
| **assolo «tenuto»: vamp con colpi a tempo sull'ultimo accordo del foglio, 20 s (con e senza batteria)** | **nessun gap**; la sezione sostituita esce **rossa** (non saltata); il resto 88,7–94,3% entro 250 ms (come il caso con assolo vero: 88,7–94,3%) |
| un solo colpo di quell'accordo che suona e decade per 20 s | nessun gap; sezione rossa; il resto 88,7–96,2% |

È il compromesso voluto (un accordo uguale all'ultimo del foglio che dura non è un gap): ma l'utente vede la sezione rossa con 20 s di audio che il foglio non ha, senza «Fuori dal foglio» (bug 6, bassa).

## C. Ritocco (SE, 13, 320; `round11-tester-nudge.cjs`, `round11-tester-nudge10-slow.cjs`, mio `round10-tester-nudge.cjs` rieseguito)

| controllo | SE | 13 | 320 |
|---|---|---|---|
| ⇄ in ogni intestazione: dopo la sincronizzazione / reload 1 / reload 2 / riapertura dalla libreria (sintetico, 6 sezioni) | 6/6 ×4 | 6/6 ×4 | 6/6 ×4 |
| il ⇄ apre il foglio «Sposta sezione» | sì | sì | sì |
| pressione lunga con tremolio 5 / 8 / 10 px (finto dito con CDP, spostamenti lungo x ogni 50 ms): il foglio si apre; rilascio a ~100 ms dall'apertura sopra il pulsante −0,25: **nessun tempo cambia** | sì ×3 | sì ×3 | sì ×3 |
| deriva di 13 px (sopra la soglia di 12) e scorrimento di 20 px: nessun foglio, nessun tempo cambiato | sì | sì | sì |
| fermo (0 px), rilascio 250 ms dopo l'apertura: nessun tempo cambia | sì | sì | sì |
| fermo, rilascio **330 / 400 / 700 ms** dopo l'apertura sopra il pulsante −0,25: nessun tempo cambia | **no: −0,25 s applicato** (3/3) | no (3/3) | no (3/3) |
| tap deliberato sul pulsante 150 / 400 ms dopo il rilascio: accettato (−250 ms) | sì | sì | sì |
| tic dopo 4 ritocchi di −0,25 su un accordo da 2,4 s (il precedente scende a 0,2 s): nessuna coppia di tic a meno di 0,6 battiti (minimo 0,595 s su 16 intervalli) | sì | sì | sì |
| gap: +0,25 poi −0,25 −0,25: la fine del gap segue l'accordo (0 ms di scarto) e il gap resta | 46,55–66,77 → 66,52 → 66,27 | uguale | uguale |
| suggerimento: sincronizzazione + 3 reload → 1 volta | sì | sì | sì |
| ancora su una sezione: il ritocco di sezione (+0,25, −0,25, +0,05) sposta l'ancora della stessa quantità (40,60 → 40,85 → 40,60 → 40,65) | sì | – | – |
| … e tutti gli accordi della sezione di 250 ± 5 ms, nessun altro | **no** (bug 5) | – | – |
| mio `round10-tester-nudge all` (B1–B6, L1–L2, G, X, Y) con pausa di 450 ms: solo G3 e X5 falliscono (G3 è atteso: la soglia è ora 12 px e non 6; X5 è il bug 5) | 2 FAIL | 2 FAIL | non eseguibile dal punto G0 (cfr. sotto) |

Senza la pausa (script originale) falliscono anche X1, X2, X5, Y0, Y1 su SE e 13: il foglio aperto con un tap (riga della schermata di sincronizzazione, ⇄ dell'intestazione) scarta ogni tap nei primi ~300 ms (bug 4). Sul 320, `round10-tester-nudge gesture` non parte: lo script mette l'accordo in fondo alla vista, dietro la barra fissa (a 320×568), e la pressione lunga non lo raggiunge: è un limite dello script, il mio `jitter` (accordo a metà schermo) passa su 320.

Il tic dopo un ritocco: come da decisione del round 11 i tic seguono la **griglia**, non l'inizio dell'accordo: dopo −1 s su un accordo, il primo tic cade 0,396 s dopo il nuovo inizio (battito della griglia) e l'accordo precedente (0,2 s) ne ha 0 nella timeline e 1 al confine udito (a −0,03 s dal bordo: arrotondamento). Non è un difetto, ma il cambio ritoccato non ha un tic.

## D. Tagli e regressione

### D1. Tagli del reale (`round11-tester-realcut.mjs`, e il mio del round 10 sul motore del round 10 per il confronto)

| caso | round 10 | round 11 |
|---|---|---|
| senza i primi 60 s | `yssgygygggrr`, sez. 2 e 3 «non presenti» a torto, verde sbagliato nella 4 (5/16) | `yyygygygggrr`, 0 saltate, 0 verdi sbagliati, 2/295 eventi su musica di altra sezione |
| senza 60 s + taglio 30% | `rrsrrrrrrrrr`, tutto rosso | `yyyyssssssss` |
| senza 60 s + taglio 45% | `ygygssssssss`, verdi sbagliati 2 e 4 (16/16 ciascuno) | `yyygyyssssss`, 0 verdi sbagliati (sez. 6 gialla) |
| senza 60 s + taglio 70% | `ygygygysssss`, verdi sbagliati 2, 4, 6, saltate a torto 8 e 9 | `yyygygyyysss`, 0 verdi sbagliati, 0 saltate a torto |
| taglio al 20% | `rrrrrrrrrsrr`, non riconosciuto | `yyysssssssss`, 0/60 eventi su musica sbagliata |
| taglio al 30% | `rgygssssssss` | `rgyyssssssss` |
| taglio al 45% | sez. 6 **verde sbagliata** (11/11 in anticipo di 2,7–3,7 s) | sez. 6 **gialla**, 0 verdi sbagliati (4 eventi su 151 su musica di altra sezione, come prima) |
| taglio al 70% | `rgygygygyrss` | uguale |
| una sezione tolta (3, 4, 5, 6, 7, 9) | 6/6 giuste, 0 verdi sbagliati | 6/6 giuste, 0 verdi sbagliati; gap 0 (round 10: 2, uno falso); i colori delle sezioni 9 e 12 cambiano di un livello (g↔y, r↔y) in 10 scenari su 17 senza che nessuna diventi verde sbagliata |
| due sezioni uguali / tolta + ripetuta | `4+5`, `7+8`, `5+rip.7`, `3+rip.8`: la saltata non è quella tolta (36 o 16 eventi su musica sbagliata, fino a 123/292) | **identici** (37, 2, 37, 125 su musica sbagliata); `3+rip.8` ha ancora **2 verdi sbagliati (sez. 4 e 6, 16/16 oltre 250 ms)** e 2 gialle sbagliate: invariato dal round 10 (bug 9) |
| assolo di 20 s al posto di una sezione (4, 6, 8 con tonalità cambiata) | 3 su 4 non segnate «non presente» | invariato (rossa, 17–19 eventi su musica sbagliata); 1 gap trovato (round 10: 1–3 contando quello falso) |
| gap falsi | 2–3 per prova | 0–1; **1 in `remove 3 and 9` (85,8–89,0 s, 3,2 s a fine Chorus 1)**: non è un'assenza vera del foglio, è l'ultimo tratto prima dell'incollatura |

Sintetico (`round9-tester-engine all` semi 61…127, e `round11-tester-engine-seeds` semi 311…359): 35 tagli × 5 semi, 120 sezioni verdi, **0 verdi sbagliati, 0 saltate a torto**; sezioni mancanti 25/25 giuste per gruppo di semi (5 + 5 semi), 0 saltate a torto; intro estranea 15/15 con primo accordo a ≤ 0,02 s. Tempo libero (`round10-free-bench.mjs`, `round9-tester-engine` B4): giallo 85,6% entro 250 ms (richiesto ≥ 75 ✓), mai verde ✓, **rosso 52,4% (richiesto < 50 ✗)**: invariato dal round 10 (bug 8).

### D2. Regressione

- `npm test`: **274/274**, 0 `todo`, 58 s.
- `node --test "test/regression/*.test.js"`: 2 test (1 verde, 1 `todo`).
- `bash test/e2e/round10-regress.sh` completo: eseguito per intero (60 script, 48 senza FAIL). Con FAIL: (a) `round7 flow` 360/SE/13, C5: l'attesa `/1 verificate/` è vecchia, ora il testo è «1 verificata a orecchio» (singolare voluto: test da aggiornare); (b) `round7-tester-app synth` C3c e crash a C6b: come nel round 10 (punto debole noto); (c) `round8 all` 360/SE/13 e `round8-tester-app sync` 320/360, S1 «righe ≤ 64 px» (54–78/94 px): come nel round 10; (d) **`round9 corr` SE, 13, 320: K1 «le istruzioni non sono coperte da «Cambio!»» FALLISCE 3/3 (nel mio round 10 passava): bug 10**; (e) **`round10 all SE`: N1 «ritocco di sezione −0,05» fallisce (0 accordi spostati: tap entro 300 ms dall'apertura del foglio, bug 4) e lo script poi si ferma** (l'implementatore dichiarava 0 FAIL). Il resto verde (round 4, 5, 6, 7 panel/tester, 8 tester, 9 app/decode, `round9-decode-check`: app − Node mediana 0 ms, p90 0 ms, max 208 ms)
- E2E del round 10 (miei) rieseguiti: `round10-tester-clicks` (copia → A), `round10-tester-realcut` (D1), `round10-tester-nudge all` SE/13/320 (C; con la pausa: 2 FAIL attesi), `round10-tester-real user` SE e 13 (D4). Non rieseguiti: `round10-tester-texts` (testi a 320/360/SE/13: l'unico cambio visivo è il foglio a 320, bug 7), `round10-tester-tempo/phase/noalign` (sostituiti da A2).

### D3. CPU ×4 (`round9-perf.cjs SE 4 2`, alternati; round 10 da un worktree con `dist` costruito a parte)

| | totale | decodifica | analisi | frame più lungo |
|---|---|---|---|---|
| round 10, lotto 1 | 12,6 / 13,1 s | 2,08 / 2,17 | 10,3 / 10,7 | 120 / 109 ms |
| round 11, lotto 1 | 12,5 / 11,9 s | 2,20 / 1,80 | 10,1 / 9,7 | 118 / 113 ms |
| round 10, lotto 2 | 13,1 / 12,5 s | 2,20 / 1,88 | 10,7 / 10,4 | 108 / 126 ms |
| round 11, lotto 2 | 12,4 / 12,4 s | – | – | 115 / 111 ms |

Medie: totale 12,8 contro 12,3 s, frame più lungo 116 contro 114 ms. La differenza dell'implementatore (92–120 contro 123–146 ms) viene dal momento della macchina (le sue corse non erano alternate); a parità di condizioni non c'è differenza. Il frame lungo (≈ 108–126 ms) è il disegno della schermata di sincronizzazione a ×4, uguale in entrambi.

### D4. Prova da utente su SE e 13 con l'mp3 reale (`round11-tester-real.cjs … verse1,user`)

Sincronizzazione 3,9–4,4 s (analisi) su SE e 13; 12 intestazioni con ⇄ senza altro; pannello «D», prossimo «G», tempo «♩≈141,4» (= BPM misurato della schermata: corretto, bug 12 del round 10 chiuso); play dal Verse 1 al Chorus 1: nessun «Fuori dal foglio», chiaro il passaggio G (57,9) → Chorus (63,43) con tic accentati; pressione lunga su un accordo (700 ms): foglio aperto, 1 sola scheda, il tempo non cambia all'apertura; ritocco −0,25/−0,05 e «Ascolta da qui» (si ferma da solo); ritocco di sezione dalla riga: la riga diventa «verificata»; da metà: tocco su un accordo a play fermo apre il diagramma (non fa partire), a play acceso salta all'accordo (2,0 → 254,0 s con l'accordo a 252,9). Esitazioni, a differenza del round 10 (tutte minori):

1. Il suggerimento «Tieni premuto un accordo…» compare subito dopo la sincronizzazione, una volta: bene; ma a chi tiene il dito più di mezzo secondo dopo che il foglio si è aperto il rilascio applica −0,25 s di nascosto (bug 3).
2. Nelle sezioni libere (Verse 1, Verse 6, Chorus 12) il clic non «tiene» il brano (bug 2): è la prima cosa che l'utente sente nella prima strofa.
3. Il Chorus 1 mostra nell'intestazione «♩ = 96» e nel pannello «♩≈100,9»: due numeri per lo stesso tempo (il primo è il tempo dichiarato dal foglio, il secondo il misurato): non confonde troppo, ma è il solo posto dove i due compaiono insieme.
4. A 320 i quattro pulsanti di ritocco vanno su due righe (3 + 1): «+0,25 s» resta solo (bug 7).

## E. Chorus 1 (eventi 35–50) nell'app e decodifica a pezzi (richiesta del coordinatore: l'utente lo sente «fuori tempo» su telefono)

**In-app, Chromium (SE; stato salvato dopo la sincronizzazione del reale)**, tempi della timeline contro i miei picchi d'attacco (`round11-tester-indep.py`): dei 16 eventi 35–50 (G C G D G C G D G C G D Em A Em D), 15 hanno un attacco forte entro ±0,16 s e **mediana 0 ms**: scarti −0,00 +0,00(36) +0,16(37) −0,03 0,00 −0,28(40, due attacchi a ±0,3 s: ambiguo) −0,05 +0,10 +0,02 0,00 +0,02 +0,05 0,00 +0,06 +0,05 −0,01(50). Massimo 0,28 s (evento 40, cambio morbido). Quindi **in Chromium il Chorus 1 sta sui cambi veri**. Nessun salto a 45 o 90 s: la mediana dello scarto dagli attacchi per pezzo da 45 s è 21, −1, 10, 12, 8, 11, 9, 11, 5, 21, 8, 21 ms (pezzo 2 = 45–90 s, che contiene il Chorus 1: −1 ms). Motore Node contro app: 324/328 eventi entro 30 ms; i 4 diversi (eventi 4, 5, 243, 261: 0,09–0,19 s) sono rumore di decodificatori diversi, non a confini di pezzo.

**Decodifica a pezzi di 45 s (`audiodecode.js`)**, lettura del codice e del file:
- Il pezzo k ≥ 2 è messo a `round(a·spf·ratio) − delta`: posizione assoluta per indice di frame, **delta misurato solo sul primo pezzo** (campioni scartati dal decodificatore all'inizio: Xing e ritardo del codificatore). Non c'è accumulo da pezzo a pezzo.
- Un decodificatore che aggiunge o toglie campioni di «priming» a ogni pezzo (tipico 1105 = 576 + 529 campioni a 44,1/48 kHz ≈ 23–25 ms, ma anche i frame di lead) sposterebbe di una quantità **costante** tutti i pezzi ≥ 2 rispetto al primo: da 25 a ~50 ms, non secondi. Il controllo sulla lunghezza (`|len − atteso| > 1% + 64` campioni, cioè ±450 ms a 45 s) non lo vedrebbe. Se il decodificatore rifiuta il pezzo o la lunghezza è fuori del 1%, si torna alla decodifica intera (corretto).
- Il Chorus 1 (63–88 s) cade nel **pezzo 2** (45–90 s), le strofe 2–6 nei pezzi 3–11: un errore di priming costante colpirebbe da lì in poi, ma di decine di ms. **Da solo non spiega un Chorus «completamente fuori tempo».**
- **Sospetto più forte (non verificato, nessun iOS qui):** l'mp3 reale è **VBR/ABR senza intestazione Xing/Info** (pacchetti da 240, 288, 336, 384, 480 byte; nessun `Xing`/`Info`/`VBRI` nei primi 4 KB; bit rate medio 110913 b/s; ID3 con copertina). Su Safari/iOS un `<audio>` con VBR senza tabella dei punti stima la durata dal primo frame e cerca (seek) per proporzione di byte: `currentTime` e posizioni dopo un salto si scostano dal tempo vero di secondi e **crescono con la posizione**, mentre l'analisi (frame per frame) è esatta. Sintomo atteso: la prima strofa quasi a posto, poi sempre più fuori; è compatibile con la segnalazione. Controllo suggerito: stesso file ricodificato in CBR (o con intestazione Xing) sul telefono; oppure registrare `audio.currentTime` contro la posizione decodificata. Non si verifica con Chromium (qui `currentTime` è esatto: tic/attacchi coerenti, scarto tic–attacco 10 ms).

## Bug

| # | gravità | descrizione |
|---|---|---|
| 1 | media | **Regressione dell'evento 306 (D, Verse 6): 473,15 s invece di 473,83 (−0,68 s).** La nuova `chromaLead` (`refine.js`) anticipa un cambio G → D fino al primo punto in cui il croma di D supera quello di G di 0,1 per 0,3 s: nel G con le note di passaggio D/F#/A succede 0,6 s prima del vero cambio (il mio attacco è a 473,80, il croma di G collassa a 473,85–473,90, il G dura 3,2 battiti come negli altri G della sezione). Il pannello mostra D mentre suona ancora G. Unico peggioramento reale sui 328 eventi (1 miglioramento: l'evento 32, 53,73 → 53,05, sull'attacco; il 69 è neutro). `todo` in `test/regression/round11-tester-real.test.js` |
| 2 | media | **Nelle 3 sezioni a tempo libero (Verse 1, Verse 6, Chorus 12: 183 s = 36% del brano, 337 tic) i tic intermedi non sono sui battiti veri.** Entro 40 ms da un attacco: 11%, 7%, 11% (a caso ~20%), distanza mediana 244/160/141 ms; i tic sui cambi sì (53–64%). La correzione della griglia vale per le 9 sezioni stabili (scarto ~10 ms, p90 30 ms) ma non per le libere, dove il clic usa il tempo della sezione vicina (Verse 1: 100,9 del Chorus 1) con partenza da ogni cambio. È la metà non risolta del bug 9 del round 10 e il motivo per cui l'utente può ancora sentire «clic fuori battito» nella prima strofa. Il Chorus 1 (stabile, 100,9 BPM contro 136–137 degli altri ritornelli) è meno netto (50% entro 40 ms) |
| 3 | media | **Pressione lunga: la guardia del rilascio dura 320 ms fissi dall'apertura del foglio, non «finché il dito è giù».** Con il dito fermo, un rilascio a 330, 400 o 700 ms dall'apertura, sopra un pulsante, lo preme (−0,25 s applicato di nascosto; SE, 13, 320, tocchi veri con CDP; a 250 ms regge). Annulla recupera. Servirebbe ignorare solo il primo `pointerup`/`touchend` del gesto di apertura |
| 4 | bassa | La stessa guardia scarta **ogni tap** nei primi ~300 ms dopo l'apertura del foglio, anche se il foglio si è aperto con un tap (⇄ dell'intestazione, riga di sincronizzazione): un tap a 150 ms su un pulsante del foglio non fa niente (0 accordi spostati; a 300 ms sì). A velocità umana non si vede, ma rompe `round10-tester-nudge` (X1, X2, X5, Y0, Y1) che non è stato rieseguito dall'implementatore |
| 5 | bassa | **Ritocco di una sezione ancorata:** l'ancora ora si sposta della stessa quantità (40,60 → 40,85), ma si muovono 22 accordi (non 12): la sezione prima si stira (fino a −10 ms sugli ultimi accordi) e gli ultimi accordi della sezione ritoccata si spostano di 241 ms invece di 250 (−9 ms). Con −0,25: +10 / +9 ms; con +0,05: −2 / −1 ms. Il primo accordo è esatto (era −7 ms nel round 10); `round10-tester-nudge` X5 fallisce ancora alla lettera («primo −1 ms» è la sezione prima) |
| 6 | bassa | **Assolo tenuto sull'accordo uguale all'ultimo del foglio** (vamp, o un solo colpo che decade per 20 s): non è un gap per scelta; la sezione sostituita esce rossa e il pannello non dice «Fuori dal foglio» per 20 s |
| 7 | cosmetico | A 320×568 i quattro pulsanti del ritocco (−0,25, −0,05, +0,05, +0,25) vanno a capo 3 + 1 (`test-artifacts/round-11/nudge-320-secsheet.png`) |
| 8 | bassa | **Invariati dal round 10:** (a) sezioni uguali: con due strofe tolte vicine o una tolta e una ripetuta il motore segna «non presente» un'altra (37, 37, 125 eventi su musica sbagliata), con **2 verdi sbagliati** in `3 + ripetuta 8` (sez. 4 e 6, 16/16 eventi oltre 250 ms) e 2 gialle sbagliate (round 10 bug 8); (b) tempo libero: rosso al 52,4% (richiesto < 50; round 10 bug 16) |
| 10 | media | **«Correggi a orecchio» con 35 accordi (Verse 1 del reale): «Cambio!» copre le istruzioni e gli accordi.** Con il fissaggio sopra la barra del round 11 il pulsante grande si sovrappone allo stato/righe di accordi: a 320×568 copre la riga «Prossimo: …» e tutte le chip, a SE e 13 le righe 4–5 delle chip, e «Annulla ultimo tocco / Ricomincia» finiscono tagliati dalla barra fissa; sotto il pulsante resta spazio vuoto. `round9 corr` K1 fallisce 3/3 (SE: stato fino a y 391, pulsante da 319; 320: 440 contro 188); nel round 10 passava (a 320 il difetto era l'opposto, bug 14). Screenshot `test-artifacts/round-9/corr-{320,SE,13}.png` |
| 11 | media | **Possibile causa del «fuori tempo» su telefono (non verificata):** mp3 VBR senza Xing/TOC, posizione di `<audio>` su iOS che si scosta crescendo con il tempo; la decodifica a pezzi può al massimo spostare di 25–50 ms (sezione E) |
| 12 | bassa | Un gap falso di 3,2 s (85,8–89,0) con due sezioni tolte (3 e 9): l'ultimo tratto del Chorus 1 prima dell'incollatura; prima erano 2 gap falsi nello stesso caso |

Non sono bug: il tic non cade sul cambio ritoccato (decisione round 11: tic sulla griglia); `alignment.eventBeats` non coincide con i tic uditi (sintetico: ultimo accordo 11 contro 8 tic, primo 3 contro 4): la timeline li ricalcola dalla griglia e il clic è giusto; i 12 «accordi con tic ≠ timeline» del reale sono battiti a ±40 ms dal confine; G3 del mio `round10-tester-nudge` (la soglia è ora 12 px e non 6 px per scelta); il taglio a metà sezione resta con la compressione (ora gialla, dichiarato).

## Verdetto

**Round 11 accettabile con riserva, nessun bloccante.** Le richieste dell'utente:

- **(A) Tic sui battiti veri**: nelle 9 sezioni stabili (64% del brano) sì, con un metodo mio e indipendente: intervalli regolari (0,3% oltre ±15%, prima 17%), tic ~10–12 ms dopo l'attacco (p90 30 ms), il −25 ms migliora (mediana mia 33 → 9 ms). **Nelle 3 sezioni a tempo libero (36% del brano, fra cui la prima strofa) i tic intermedi sono fuori dai battiti** (bug 2): l'utente che ascolta la prima strofa può ancora sentire il clic «che balla».
- **(B) Fine del Verse 1**: risolto e verificato (nessun gap in app su SE e 13, 55–67 s; evento 32 sull'attacco; evento 34/35 sull'attacco del Chorus). **Ma la stessa correzione ha peggiorato l'evento 306 di 0,68 s (bug 1, confermato):** 1 miglioramento e 1 peggioramento fra gli spostamenti oltre 0,25 s; nessun altro evento si sposta oltre 0,11 s. La regola `chromaLead` va ristretta (per esempio richiedere che il nuovo accordo abbia una nota che non è nel vecchio, o limitare l'anticipo quando manca un attacco nei 0,8 s).
- **(C) Ritocco**: ⇄ sempre presente, tremolio di 5–10 px ok, gap che segue, suggerimento una volta; difetti residui: rilascio oltre 330 ms (bug 3, media), tap veloci (bug 4), ancore (bug 5).
- **(E) Chorus 1 in-app (Chromium): mediana 0 ms, max 0,28 s dai cambi veri; nessun salto ai 45/90 s.** Un «completamente fuori tempo» sul telefono non nasce dall'analisi né, per grandezza, dalla decodifica a pezzi (≤ 50 ms): il sospetto è la posizione di riproduzione dell'mp3 VBR senza Xing su iOS (bug 11, non verificato).
- **(D)** Tagli: i verdi sbagliati del round 10 (taglio a metà sezione, −60 s + tagli) sono spariti (0 su reale e su 70 sintetici), il 20% è riconosciuto; restano le sezioni uguali (bug 8) e il rosso del tempo libero; prestazioni invariate; prova da utente senza blocchi.

## Non verificato

- iOS reale: pressione lunga (rilascio, tremolio, selezione del testo) e l'orologio di `AudioContext`; tutto con Chromium e tocchi iniettati via CDP. Il bug 3 potrebbe non comparire su un dito vero se iOS non genera il `click` sul pulsante comparso sotto il dito.
- Non ho ascoltato: i miei «battiti veri» sono attacchi di un flusso spettrale (±20 ms di latenza propria), non i battiti che sente un musicista; per le sezioni libere non ho un tempo vero (il pettine sceglie il passo più lento) e dico solo che i tic intermedi non seguono gli attacchi.
- Tic nel loop del reale (non rieseguito; l'implementatore: 43,9 tic per giro contro 43 battiti).
- Ritocco accanto a una sezione saltata in browser; reti lente; rumore musicale; file senza intestazione Xing/LAME.
