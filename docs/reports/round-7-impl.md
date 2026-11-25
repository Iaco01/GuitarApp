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
