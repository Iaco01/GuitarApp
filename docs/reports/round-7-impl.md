# Round 7 — Report implementatore

## Fase A — Motore di analisi

Moduli puri in `src/analysis/`: `fft.js` (radix-2, due frame reali per FFT), `features.js` (ricampionamento a 11025 Hz, sintonia, cromagramma e bass chroma con finestra 4096 e hop 1024, inviluppo degli attacchi con finestra 1024 e hop 256), `beats.js` (tempogramma comb-ACF a finestre di 10 s con confidenza, scelta del tempo con correzione d'ottava e indizi UG deboli, battiti per programmazione dinamica), `align.js` (Viterbi segmentale sull'ordine degli eventi, prior di durata per evento passato da fuori come `priorBeats`, scala locale s/battito stimata a passate successive, ricerca della trasposizione, aggancio agli attacchi e ai battiti) e `autosync.js` (`analyseAndAlign`).

Test: `test/autosync.test.js` (FFT contro DFT, template, brano corto sintetico, circa 1 s). Banco lungo: `node test/e2e/autosync-bench.mjs [semi]`. Generatore: `test/fixtures/make-realistic.mjs` (Karplus-Strong, basso, batteria, voce finta con vibrato, rumore; rubato ±15%, cambi di tempo, sezione ripetuta a tempo diverso, battuta di pausa, +30 cent, un tono sopra il foglio). Brano reale: `node test/e2e/autosync-real.mjs`.

### Banco sintetico (214 s, 112 eventi, 5 semi)

| | entro 100 ms | 250 ms | 500 ms |
|---|---|---|---|
| tutti | 97,3–98,2% | 98,2% | 99,1% |
| tempo stabile | 96,8–97,9% | 97,9–98,9% | 98,9% |
| tempo libero | 94,4–100% | 94,4–100% | 100% |

Errore mediano 5–6 ms. Trasposizione +2 trovata in tutti i semi. BPM giusti entro 1 (112, 138, 98, 126, 84), tempo libero riconosciuto come `null` in tutti i semi. Sintonia stimata 35,5–35,8 cent contro 30 veri (bias di circa +6 cent). Calcolo circa 1–1,5 s per 214 s di audio. Obiettivi (90% / 70% / trasposizione / BPM) raggiunti.

### Brano reale (513,6 s, 328 eventi, 12 sezioni)

Calcolo totale 3,1 s in Node (resample 0,08, features 2,1, allineamento 0,9, tempo 0,09). Trasposizione 0, sintonia −1,4 cent.

| Sezione | inizio | BPM |
|---|---|---|
| Verse 1 | 0:00,0 | libero (candidato 66) |
| Chorus 1 | 0:59,2 | 100,2 (confidenza bassa, 0,38) |
| Verse 2 | 1:28,0 | 141,5 |
| Chorus 2 | 2:25,5 | 137,1 |
| Verse 3 | 2:42,5 | 138,1 |
| Chorus 3 | 3:41,9 | 136,1 |
| Verse 4 | 3:58,4 | 138,2 |
| Chorus 4 | 4:58,4 | 136,5 |
| Verse 5 | 5:16,3 | 138,5 |
| Chorus 5 | 6:14,7 | 135,9 |
| Verse 6 | 6:32,4 | libero (candidato 75) |
| Chorus 6 | 7:39,7 | libero (candidato 100) |

Il quadro coincide con quello visto dal coordinatore: parte libera, primo ritornello a circa 100, band a 136–142, finale lento. I ritornelli centrali sono a circa 136, non a 96. Plausibilità: eventi e sezioni in ordine e senza sovrapposizioni; tutti i BPM della band in 130–150. Confidenza degli eventi: mediana 0,84, p10 0,44; 17 sotto 0,3, 55 tra 0,3 e 0,6, 256 sopra 0,6. Durate degli eventi: mediana 1,41 s, minima 0,26 s, massima 6,0 s.

Controllo indipendente locale (cromagramma proprio, finestre di 0,5 s, `autosync-check.mjs`), su 321 cambi tra accordi diversi: il 57,3% supera entrambe le prove (uscente 78,8%, entrante 78,2%). Spostando i cambi di ±0,9 s si scende a 7,8% / 9,7%; il massimo cade a offset 0 (curva di offset ±0,5 s). Sullo stesso controllo, il sintetico con verità vera dà 93,5%. Per sezione: 68 67 63 60 40 80 46 73 51 67 66 50 (%).

## Limiti

- Sul brano reale non c'è verità: il 57% del controllo locale è debole. Il controllo è basso anche per i limiti del cromagramma (voce, batteria, accordi del foglio semplificati rispetto a quelli suonati); le sezioni con band piena (Verse 3, 4, 5) sono le più basse (40–51%). Non so quanti cambi reali siano entro 250 ms.
- Nella versione finale dell'aggancio ai battiti, il 41% dei cambi stava entro 0,12 battiti da un battito prima dell'aggancio (chance circa 24%); dopo l'aggancio non l'ho rimisurato.
- Il sintetico è facile (accordi puliti, tempo rigido): il 98% è un limite superiore.
- Il primo evento viene collocato a 0:00,0 sul brano reale: va controllato a orecchio.
- Sintonia con bias di circa +6 cent sul sintetico, +14 sul brano corto a 22 kHz.
- Chorus 1 (100 BPM) ha confidenza BPM 0,38; i tratti liberi danno `bpm: null` e nessuna durata in battiti.
- Il capo non è considerato: gli accordi scritti sono quelli che suonano.
- Prestazioni su telefono (CPU ×4) non misurate: sono Fase B.
- Il calcolo è sincrono: per la barra di progresso e "Annulla" servirà un wrapper a pezzi o un worker (Fase B).

## Fase B0 — Miglioramento dell'allineamento sul brano reale

Esito onesto: **l'obiettivo (controllo locale ≥ 75%) non è raggiunto**. Il controllo passa da 57,3% a 58,6%, un guadagno dentro il rumore (errore standard su 321 cambi: circa 2,7 punti). Non ho trovato nessuna modifica che migliori il reale in modo chiaro. Procedo con la UI: le sezioni gialle si correggono a mano.

### Cosa ho provato (ogni riga misurata con `autosync-real.mjs`, banco sintetico a parte)

| Prova | Controllo locale | Vicino ai battiti | Tenuta? |
|---|---|---|---|
| Base (Fase A) | 57,3% | 56% | - |
| Peso 80–1000 Hz (centro 250/400 Hz, larghezza 0,9–1,0 ottave) | 55,8–57,6% | 54–56% | no, rumore |
| Whitening temporale (sottrae 0,5–0,8 della media di ±1,5–3 s per bin) | 56,7–57,6% | 55–57% | no |
| Mediana corta del croma (3 o 5 frame) | 57,3–57,9% | 54–55% | no |
| Aggancio ai battiti: tolleranza 0,3 battiti | 57,0% | 58% | no (neutro) |
| Aggancio ai battiti interi con tolleranza 0,5 | 51,7% | 86% | **peggiora** |
| Aggancio al battito o mezzo battito (tol. 0,25–0,5) | 57,3% | 56% (89–92% con griglia a mezzi battiti) | neutro, lasciato spento |
| Seconda passata con bonus di griglia battiti (Viterbi, soft, gamma 2–8) | 56,7–57,6% | 57–58% | neutro, +1 s di calcolo: lasciato come opzione (`opts.regrid`), spento |
| Peso del basso 0 / 5 / 8 (base 2,5) | 56,1 / 57,0 / 54,5% | - | no |
| Peso del croma 15 / 20 / 30 (base 10) | 59,2 / 59,8 / 59,5% | 55–57% | **tenuto 15** (coerente ma marginale) |
| Prior di durata λ 4 / 16 (base 8) | 57,9 / 52,3% | - | no |
| Interpolazione dei picchi su log-magnitudine | neutro | neutro | tenuta (più corretta, nessun costo) |

### Prima / dopo (brano reale, 328 eventi)

| | Prima | Dopo |
|---|---|---|
| Controllo locale (entrambi / uscente / entrante) | 57,3 / 78,8 / 78,2% | 58,6 / 79,8 / 78,5% |
| Per sezione (1–12) | 68 67 63 60 40 80 46 73 51 67 66 50 | 68 67 63 60 46 80 49 73 49 73 69 50 |
| Cambi entro ±0,12 battiti da un battito (224 cambi di sezioni a tempo stabile) | 56% | 57% |
| ...da un battito o mezzo battito | 89% | 89% |
| Controllo con cambi spostati di ±0,9 s | 7,8 / 9,7% | 8,4 / 9,7% |
| Calcolo (Node) | 3,5 s | 3,4–4,0 s |
| BPM per sezione | 100,2 141,5 137,1 138,1 136,1 138,2 136,5 138,5 135,9, libere: 1, 11, 12 | 100,3 141,6 137,1 138,1 136,1 138,2 136,5 138,5 136,0, libere: 1, 11, 12 |

Banco sintetico (5 semi, entro 250 ms su tutti): 97,3–98,2%, praticamente uguale alla Fase A (98,2%; un evento in meno su due semi). Trasposizione +2 e BPM giusti in tutti i semi, obiettivi raggiunti.

### Cosa ho capito

- **I cambi sono davvero spesso a mezzo battito.** Con l'aggancio ai battiti interi (tolleranza 0,5) il 86% dei cambi finisce su un battito ma il controllo scende a 51,7%: circa il 44% dei cambi cade su un mezzo battito. Quindi "più cambi sui battiti" non è un obiettivo valido; sulla griglia a mezzi battiti sta già l'89–92% (chance circa 48%).
- **Il controllo locale sottostima.** Per coppie di accordi: G→D 63%, D→Em 72%, Em→D 85%, G→C 73%, Am→C 71%, ma D→G 32%, C→G 39%, C→Em 13% (n=8). Sono coppie con due note in comune (C/Em/G): il controllo con finestre di 0,5 s non le distingue bene, e lo stesso vale per il croma. Le sezioni "peggiori" (Verse 3, 4, 5) hanno molte di queste coppie. Con la verità sintetica lo stesso controllo dà 93,5%, ma con accordi più distinti.
- **Il picco del controllo è a offset 0/−0,05 s** (curva da −0,6 a +0,6 in passi di 0,1: 10 13 22 35 45 56 57 50 35 21 13 10 9), quindi non c'è un ritardo sistematico residuo.
- **Primo evento a 0:00,0: non è un artefatto.** L'audio ha già segnale forte a 0 s (non c'è silenzio iniziale): niente da togliere.
- **Bias della sintonia: è del generatore sintetico, non del motore.** Su toni puri a −30/0/+30 cent lo stimatore dà −29,7/+0,2/+30,3. Il +6 cent viene dall'accordatura delle corde Karplus-Strong del generatore (ritardo frazionario); sul brano reale la stima è −1,4 cent. Nessuna correzione necessaria.
- **Accordi `*`**: l'annotazione viene tolta dal parser e non arriva ai nomi degli eventi (l'insieme di accordi del brano è G, D, Em, Am, C, A), quindi con i soli moduli di `src/analysis` non posso trattarli a parte; la prova sul peso del basso non ha dato nulla.

### Modifiche tenute

- `G_CHROMA` 10 → 15 (peso del croma rispetto al prior di durata): +1,3 punti di controllo, banco invariato entro un evento.
- Interpolazione dei picchi spettrali su log-magnitudine.
- `analyseAndAlign` accetta `opts` (`feat`, `align`, `snapTol`, `snapHalf`, `regrid`, `gridGamma`, `gridWidth`) per gli esperimenti; i default sono quelli della Fase A più le due modifiche sopra. Le sezioni espongono `beatTimes`. Nuovo `gridBonusFrames` in `align.js`, `snapToBeats` con mezzi battiti opzionali (spenti); `autosync-real.mjs` stampa ora la vicinanza ai battiti. Due test unitari in più.
- Non ho tenuto whitening, mediana, nuovo peso in frequenza, aggancio ai mezzi battiti, seconda passata a griglia: nessun miglioramento misurabile.

### Limiti

Senza una verità vera sul brano reale non si distingue +1,3 punti da rumore. Per passare davvero da 58% a 75% servirebbe una verità annotata a mano su alcune sezioni (anche solo 20 cambi), non altre ottimizzazioni alla cieca sul controllo.
