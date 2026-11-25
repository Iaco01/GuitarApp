# Round 9 — Report implementatore

Verdi affidabili, tempo libero, gap in play, memoria e prestazioni (punti 1–8 di `docs/rounds/round-9-impl.md`). Nessun testo del brano reale è riportato: solo conteggi, tempi, nomi di sezione e di accordi. Decisioni in `docs/DECISIONS.md` ("Round 9"). "Prima" = commit `88c829a` (fine round 8), misurato in un worktree a parte sulla stessa macchina; "dopo" = HEAD.

## 1. Audio più corto del foglio: nessun verde sbagliato (bug 1)

`node test/e2e/round8-tester-cut.mjs` (5 semi × tagli al 50, 60, 70, 80, 90%, generatore del tester; verde sbagliato = sezione verde con più del 10% dei cambi udibili sbagliati di > 250 ms).

| | prima | dopo |
|---|---|---|
| sezioni verdi sbagliate su 25 tagli | **6** (70%: 5 semi su 5, la sezione 4 con 5 cambi su 8 sbagliati di 1,5–8 s; 50%: 1) | **0** |
| cambi udibili sbagliati di > 250 ms nelle sezioni stabili | taglio 50%: 10 su 12, 8 su 8; taglio 70%: 5 su 8 (sezione 4, verde) | **0 su tutte le sezioni stabili** (resta la sezione a tempo libero, rossa) |
| cosa vede l'utente dopo il taglio | gli ultimi accordi schiacciati in fondo, sezioni "rosse" con tempi inventati | le sezioni dopo il taglio sono **"non presente nell'audio"** (senza tempi; in play la timeline le salta), la sezione tagliata a metà salta gli ultimi accordi ("−N accordi") |

- Il Viterbi può saltare gli ultimi eventi (costo 5 ciascuno, **solo se l'audio davvero finisce**: ciò che resta è meno del 35% della loro durata attesa) e una sezione intera nel mezzo (costo 12 per evento, e senza gap subito dopo). Sezione 5 (Bridge) tolta dal mezzo dell'audio (test): "non presente", tutto il resto entro 250 ms (≥ 95%). Dettagli in DECISIONS.
- **Controllo di coerenza del tempo**: in una sezione a battito stabile il tempo implicito di ogni cambio (battiti del foglio / durata scelta) deve restare entro ±15% del BPM della sezione (a −60% fiducia zero; tempo doppio o dimezzato = stesso battito); la confidenza della sezione scende se più del 10% dei cambi sono fuori. **Si applica solo se le durate del foglio sono attendibili** (almeno il 60% delle sezioni stabili si accorda con sé stesso): con le durate stimate dal testo, come sul brano reale, quasi ogni sezione risulterebbe "sbagliata" e il controllo non discrimina, quindi non penalizza. Effetto misurato: nel banco di confidenza dell'implementatore le sezioni con un accordo mancante nell'audio (`drop3`) che prima erano verdi con un cambio sbagliato di 0,8–1 s ora sono rosse (3 sezioni).
- Sintetico normale non peggiora: tester-b, 82 sezioni stabili verdi, 704 cambi, 100,0% entro 250 ms (prima identico); `round8-long.mjs` e `round8-tester-a.mjs` invariati (stabili 100/100/100% su 3 semi, taglio al 70% stabile 100%); `npm test` 222/222.
- Durante il lavoro ho trovato e tolto tre falsi salti che i miei stessi cambiamenti introducevano (il reale perdeva le sezioni 11 e 12; "ritornello finale ×3" scendeva dal 100 al 92,7%; un altro brano che condivide accordi trasposti prendeva sezioni verdi): i controlli sono nei test (`test/round9-engine.test.js`) e in `round9-real.mjs`.

## 2. Intro estranea (bug 3)

Intro di 15 s di musica estranea prima del brano (3 semi del tester, `round8-tester-a.mjs`; test `foreign intro of 15 s`):

| | prima | dopo |
|---|---|---|
| primo evento rispetto al vero | **−3,06 / −3,07 / −3,08 s** (in anticipo), confidenza 1,00 | **+0,01 s** nei 3 semi (limite del test: 0,5 s) |
| confidenza del primo evento | 1,00 per costruzione | dal confronto tra l'accordo dopo e prima dell'inizio: dopo silenzio o musica diversa ≥ 0,75 (1,00 con intro estranea e con inizio pulito); alta solo se vero |

Il gap iniziale non viene riportato come riga (non c'è un "gap" a inizio brano: il primo evento parte dove parte il foglio, il resto è intro).

## 3. Tempo libero: precisione e confidenza (bug 7)

Raffinamento (`src/analysis/refine.js`): finestra [−1,0; +0,3] s, primo attacco forte in cui il basso passa alla fondamentale del nuovo accordo (o una nota che distingue il nuovo accordo); usato solo se differisce ≥ 0,4 s dal confine del croma o lo conferma entro 0,15 s con attacco netto. Confidenza dai due stimatori (concordi = alta, 0,55 il massimo: mai verde; raffinato ≥ 0,4 s: 0,45 / 0,40; altrimenti nitidezza del croma, 0,1–0,55). Giallo libero da 0,35.

Quota dei cambi entro 250 ms, per colore della sezione (solo sezioni senza battito stabile):

| banco | colore | prima: sezioni / cambi / entro 250 ms | dopo: sezioni / cambi / entro 250 ms |
|---|---|---|---|
| **tester** (`round8-tester-b.mjs`, 114 sezioni, 930 cambi) | giallo | 30 / 214 / 74,8% | 29 / 209 / **88,5%** |
| | rosso | 2 / 12 / 41,7% | 3 / 17 / **35,3%** |
| | verde | 0 | 0 |
| **implementatore** (`round8-confidence.mjs`, 229 sezioni, 2202 cambi) | giallo | 21 / 166 / 77,1% | 26 / 198 / **93,9%** |
| | rosso | 21 / 128 / 38,3% | 16 / 96 / **26,0%** |
| | verde | 0 | 0 |

Requisiti: giallo libero ≥ 75% su ogni banco (88,5% e 93,9%; per generatore sul banco dell'implementatore: generatore del tester 72,2% su 8 sezioni / 36 cambi, il mio generatore 98,8% su 18 / 162 — il primo è sotto il 75% ma su pochi cambi e il banco intero lo supera); rosso < 50% (35,3% e 26,0%); tempo libero mai verde (0).

Correlazione di rango tra confidenza ed errore sugli eventi del tempo libero (Spearman, **negativa = la confidenza alta sta dove l'errore è basso**; in round 8 il tester riportava +0,034 "nessun legame"):

| banco | prima | dopo |
|---|---|---|
| tester (84 eventi) | +0,034 | **−0,412** |
| implementatore (294 eventi) | −0,365 | **−0,566** |

Eventi del tester nel tempo libero per classe di confidenza (entro 250 ms): 0–0,2: 15% (20 ev); 0,2–0,4: 23% (13); 0,4–0,55: **88%** (33); 0,55–0,75: 78% (18) (prima: 7% / 36% / 25% / 33%).

Sezioni con arpeggio (`free-arp`, 12 sezioni, % entro 250 ms per sezione e colore):

| seme | prima (tutte gialle) | dopo |
|---|---|---|
| 3 | F1 0 · F2 80 · F3 17 · F4 20 | F1 50 r · F2 80 y · F3 33 r · F4 40 y |
| 14 | 0 · 20 · 17 · 0 | 67 y · 20 r · 50 y · 60 y |
| 27 | 17 · 40 · 17 · 60 | 67 y · 80 y · 67 y · 60 y |
| media | 24% | **56%** (cambi sbagliati di 0,7–0,9 s portati a 0,00 s dove il basso o una nota del nuovo accordo si sente) |

Le tre rosse sono giuste al 50%, 33%, 20%; le nove gialle al 40–80%. Cosa resta sbagliato: quando la prima nota del nuovo accordo è una nota che il vecchio accordo ha già (la quinta, per esempio) l'audio non dice dove inizia l'accordo; quei cambi restano al croma (in ritardo di 0,7–0,9 s) con confidenza bassa.

Rubato giusto: sezioni a rubato del tester (cambi tutti giusti): **gialle con confidenza 0,50** (prima 0,48–0,55), 14 su 18 riconosciute come tempo libero, 4 verdi; nessuna rossa.

## 4. Gap in play e gap corti sul reale (bug 2, 9)

- In play, dentro un gap ≥ 3 s: nessun accordo evidenziato (il prossimo ha il tratteggio), pannello "Fuori dal foglio" e "Riprende tra N s con «C»" (19 → 2 s misurati su un assolo di 20 s), barra dell'accordo nascosta, pannello alto uguale (137 px a SE) dentro e fuori dal gap; prima e dopo il gap gli accordi tornano evidenziati. `round9.cjs gap` (G1–G10).
- Bug 9: la sezione prima del gap tiene BPM e verde (la finestra del tempo non include più il gap: prima "tempo libero").
- Gap < 3 s: non sono gap, l'accordo precedente dura fino al successivo.
- **Reale** (`test/e2e/round9-real.mjs`, mp3 da 513,6 s, 328 eventi): gap ≥ 1 s prima **8** (1,8–4,2 s, tutti Chorus/Verse); dopo **1**:

| gap | tra | durata |
|---|---|---|
| 0:59,3–1:03,5 | Verse 1 e Chorus 1 (sezione 2) | 4,2 s |

Gli altri sette (2,6 / 2,4 / 2,6 / 2,6 / 2,4 / 1,8 / 2,1 s) sono ora battute di passaggio assorbite dall'accordo precedente (durata massima di un accordo 5,4 s, 7 accordi sotto 0,5 s).

Sul reale (12 sezioni): prima 6 verdi + 6 gialle (3 libere: 1, 11, 12); dopo **6 verdi, 3 gialle, 3 rosse**; le tre rosse sono le stesse sezioni libere 1, 11 e 12 (confidenza 0,16 / 0,17 / 0,30): il raffinamento non trova evidenza (quasi tutti i cambi "keep" con nitidezza mediana 4–5,5) e la vecchia regola le faceva gialle sulla sola nitidezza, che i banchi dicono non separare nulla. È una scelta prudente non verificabile (nessuna verità sul reale): se in realtà sono giuste, il rosso è pessimista. Il riconoscimento resta "sì" (3 rosse su 12).

## 5. Rumore: «Usa comunque» e soglia (bug 5)

- Con "Audio non riconosciuto" compare «Usa comunque»: tiene l'allineamento con tutte le sezioni al massimo gialle (`forced`), nessuna verde. `round9.cjs noise` N1–N4 (altro brano, silenzio).
- Soglia: oltre al conteggio dei rossi vale il rapporto margine/punteggio della trasposizione (`match`): brano giusto 0,16 pulito, **0,30–0,39 con rumore bianco da −5 a −12 dB**, rosa −5 dB 0,32; rumore, silenzio, altro brano 0,00–0,07. Con ≥ 0,12 il brano è riconosciuto: **bianco −10 dB e rosa −5 dB ora sì** (allineati entro 250 ms al 90–92%; le sezioni restano rosse/gialle). Un altro brano con accordi in comune non è riconosciuto (trasposizione non netta / un solo tratto giallo e il resto saltato). Test normale `right song at SNR -10 dB white or -5 dB pink` (prima `todo`).
- Limite: il reale ha `match` 0,122 (prima della correzione della coda 0,087), cioè vicino alla soglia: un reale molto rumoroso con quasi tutto rosso potrebbe non passare e andrebbe forzato con «Usa comunque».

## 6. Tap tempo e campo numerico con allineamento (bug 6)

Con un allineamento attivo − , +, il campo del numero, «Applica» e i due «Tap tempo» sono disattivati, con la stessa nota fissa. `round9.cjs lock` L1–L3 e `round8-tester-c-app.cjs bpm` (B2a, B2c aggiornati).

## 7. Prestazioni e memoria (bug 8)

iPhone SE (375×667), Chromium headless, CPU ×4, mp3 reale da 513,6 s, nessun altro processo attivo (stessa macchina per prima e dopo).

| | prima (3 corse) | dopo (3 corse) | obiettivo |
|---|---|---|---|
| totale decodifica + analisi (app) | 11,0 / 11,5 / 11,6 s | 11,5 / 11,7 / 11,6 s (altra serie con lo stesso build: 11,1–11,6 s) | < 12 s |
| frame più lungo | 168 / 191 / 212 ms | **81 / 81 / 107 ms** (altra serie 98–131 ms) | < 150 ms in 3 su 3 |
| compiti lunghi (massimo) | 62–75, fino a 178 ms | 2–3, fino a 97 ms | — |
| «Annulla» a metà (metodo del tester, incl. il click di Playwright) | 0,70 / 0,76 / 1,01 s | **0,33 / 0,33 / 0,35 s** | < 0,4 s |
| «Annulla» misurato dalla pagina | – | 30–58 ms | – |
| picco RSS del processo (somma dei processi Chromium, metodo del tester) | **+403 / +425 MB** | **+77 / +84 / +99 MB** (−75..−80%) | ≥ −30% |
| Node: analisi del reale (44,1 kHz) | 2,0–2,3 s | 1,86–1,93 s | – |

Cosa è cambiato: (1) l'mp3 si decodifica **a pezzi da 45 s** (`src/mp3frames.js`, scanner dei frame layer III, puro e testato; 4 frame di rincorsa; i pezzi sono posizionati con il ritardo che rivela il primo): mai più di un pezzo di audio decodificato alla volta, sparisce il compito lungo di 160 ms all'arrivo dell'audio; stessa linea del tempo dell'intero (`round9-decode-check.cjs`: differenza app − Node mediana 0 ms, 326 eventi su 328 entro 100 ms, max 185 ms in sezioni libere); se non è un layer III regolare o la decodifica non torna, si decodifica tutto come prima; (2) mix mono sul posto, normalizzazione sul posto, audio rilasciato dopo le feature, niente copia dei byte; le feature erano già `Float32Array`; (3) fette più fini (tempogramma a generatore, Viterbi anche dentro un evento lungo, confidenze, feature) e l'app cede dopo 12 ms (era 40); (4) ciclo interno del Viterbi più corto (−15% sull'analisi).

Il picco del round 8 era dominato dal decodificatore nativo (l'intero brano a 44,1 kHz stereo = 181 MB + 45 MB di ricampionamento): il JS heap resta a 5–9 MB come prima. Non provato su iOS.

## 8. Testi (bug 4, 10)

- Sincronizzazione a 320 e 360 px sul reale: **0 righe su 12 con testo troncato**, BPM (o "libero") su ogni riga, righe da 54 px (prima: 6 su 12 troncate a 320, 3 su 12 a 360). Testi "controlla" / "libero"; a ≤ 340 px padding e riga di stato più piccoli. `round9.cjs texts`, `round8-tester-app.cjs sync 320/360` (S2).
- Correzione a orecchio con 35 accordi: le istruzioni non sono più coperte da «Cambio!» (stato 38 px, 10 px sopra il pulsante a SE, 13 e 320 px; il foglio scorre, il pulsante resta da 187 px); anteprima "manca 1 tocco" / "mancano N tocchi". `round9.cjs corr`.

## E2E dei round 7–8 rilanciati

`bash test/e2e/round9-regress.sh` (build fresco, log in `test-artifacts/round-9/regress2.log`, un log per script accanto). Tutti verdi tranne le cose volute dal round 8 e 9 e due corse di `round8.cjs all` finite in timeout di stato sotto carico (rilanciate a macchina libera: verdi):

| script | esito |
|---|---|
| `round4.cjs` | 44 PASS |
| `round5.cjs all SE` | 33 PASS |
| `round6.cjs real` / `audio` / `height` | 16 / 6 / 3 PASS |
| `round7-panel.cjs` | 9 PASS |
| `round7.cjs flow` su 360, SE, 13 | 15 PASS ciascuno |
| `round7-tester-a.cjs all` / `-core.mjs` / `-engine.mjs all` | 39 / 3 / 27 PASS |
| `round7-tester-robust-app.cjs` | nessun errore di pagina (`longer` e `noise` come nel round 8) |
| `round7-tester-app.cjs` `cancel` / `persist` | 7 / 5 PASS |
| `round7-tester-app.cjs synth` | 5 PASS, **1 FAIL atteso**: C3c «evidenziazione dal vivo nel tempo libero entro 250 ms» media 272 ms (round 8: 670 ms; è un punto debole dichiarato); C6b preme «+» del BPM, ora disattivato (voluto dal round 8: il test va in timeout) |
| `round6-tester-browser.cjs all` / `-fuzz.mjs` | 60 / 8 PASS |
| `round5-tester-core.mjs` / `-browser.cjs` / `-text.cjs` | 28 / 25 / 8 PASS |
| `round8.cjs all` su 360, SE, 13 | 29 PASS ciascuno (SE e 13: un `B1` non allineato in una corsa sotto carico di un altro mio script, 29 PASS al rilancio) |
| `round8-long.mjs`, `round8-tester-a.mjs`, `-b2.mjs`, `-c.mjs`, `-updated.mjs` | ALL PASS (b2: nessun verde sotto il 90%, errore mediano 8–49 ms come prima) |
| `round8-tester-c-app.cjs audio` / `bpm` (SE) | 18 / 11 PASS (bpm aggiornato: campo, «Applica» e tap tempo disattivati) |
| `round8-tester-gap-app.cjs` | ALL PASS (durante l'assolo l'evidenziazione non resta più su un accordo) |
| `round8-tester-app.cjs` `correct` / `disabled` / `panel` / `sync 320` / `sync 360` | 10 / 2 / 8 / 8 / 8 PASS (sync 320: nessun testo troncato) |
| `round8-tester-user.cjs SE` | prova da utente completata, 74 s, nessun errore di pagina |
| `round9-decode-check.cjs` | mediana 0 ms, 326/328 eventi entro 100 ms, max 185 ms |
| `round9.cjs all SE` | 50 PASS (cut, gap, noise, lock, texts a 320 e 360, corr su SE, 13 e 320); `gap`, `lock`, `cut` anche a 320, `gap` a 13 |
| `npm test` | 222/222 |
| `round6-tester-core.mjs` A1 | non rilanciato: 2 FAIL noti dai round 6–8 (tabella cambiata dalla regola della levare) |

Non rilanciati (come nel round 8): `round7-tester-user.cjs` (sostituito da `round8-tester-user`), `round7.cjs perf` e `round7-tester-app.cjs perf` (sostituiti da `round8-tester-app.cjs perf` e `round9-perf.cjs`), `round4-tester-audio.cjs` (> 10 minuti).

Script nuovi: `test/e2e/round9-real.mjs`, `round9-perf.cjs`, `round9-decode-check.cjs`, `round9.cjs`, `round9-regress.sh`; test `test/round9-engine.test.js`, `test/mp3frames.test.js`. La cartella `test/regression/` è stata rimossa: i 3 `todo` sono test normali e passano.

## Cosa non funziona / limiti

- **Il tempo libero resta in gran parte indovinato**: giallo libero 88–94% entro 250 ms sui banchi, ma sulle sezioni con arpeggio solo il 56% dei cambi è giusto; il resto ha confidenza bassa o è dentro sezioni gialle con qualche cambio sbagliato (nelle sezioni gialle gli eventi a confidenza < 0,25 sono i sospetti). Sul reale tre sezioni libere sono rosse senza che io sappia se sono giuste.
- **Taglio a metà sezione**: gli accordi dopo il taglio sono saltati uno a uno, ma l'ultima sezione tagliata può restare verde/gialla con "−N accordi": è giusto sugli accordi presenti.
- **Periodiche e copie identiche**: invariato dal round 8 (il gap può cadere su una copia o l'altra; "Outro suonato una volta in più" resta al 92,7%).
- **Coerenza del tempo** non si applica quando le durate del foglio sono stimate dal testo (il caso del reale): lì i verdi dipendono solo da nitidezza e somiglianza.
- **Soglie fragili**: la coda (0,7) e la finestra del brano e mezzo hanno margini stretti (41 e 76 punti di punteggio); `RECOGNISED_MATCH` 0,12 contro 0,122 del reale.
- Decodifica a pezzi solo per mp3 layer III con frame regolari (gli altri formati usano la strada intera, memoria alta come prima). Non provata su iOS/Safari.
- «Annulla» misurato come il tester (0,33 s) include il click di Playwright; dalla pagina è 30–58 ms.
