# Round 8 — Report del tester

Verifica indipendente della robustezza della sincronizzazione automatica (punti 1–8 del round 8). Nessun testo del brano reale è riportato: solo conteggi, tempi, nomi di sezione e di accordi. Misure fatte prima di leggere i numeri dell'implementatore (che ho letto solo per i confronti). Gli screenshot stanno in `test-artifacts/round-8/` (non versionati, mostrano il testo).

Script nuovi (tutti in `test/e2e/`):

| file | contenuto |
|---|---|
| `round8-tester-make.mjs` | musica estranea al foglio, giunzioni, dissolvenza, rumore a SNR dato |
| `round8-tester-bench.mjs` | generatore con foglio configurabile: sezioni stabili, rubato, tempo libero con arpeggio, cambi da 1 battito, accordi che condividono note, anticipi/ritardi dei cambi, rumore |
| `round8-tester-a.mjs`, `-cut.mjs`, `-fp.mjs`, `-gap-assets.mjs`, `-gap-app.cjs` | A: musica non nel foglio, audio tagliato, falsi positivi, riga e play nel gap |
| `round8-tester-b.mjs`, `-b2.mjs` | B: confidenza (banco da 114 sezioni) e banco avversario (cambi anticipati o in ritardo) |
| `round8-tester-c.mjs`, `-assets.mjs`, `-c-app.cjs` | C: rumore, silenzio, altro brano, SNR, trasposizione, BPM − / + |
| `round8-tester-app.cjs` | D ed E nell'app: `correct`, `disabled`, `panel`, `sync`, `perf`, `mem` |
| `round8-tester-user.cjs` | F: prova da utente (SE e 13) |
| `round8-tester-updated.mjs` | C3c del round 7 aggiornato alla regola nuova |
| `test/regression/round8-tester.test.js` | 3 test `todo` per i difetti ancora aperti |

## Esito

| Punto | Esito |
|---|---|
| A1 musica non nel foglio (solo 20 s, ritornello ×3, sezione ripetuta, intro, fine sfumata) | OK sul tempo stabile (100%, 3 semi); intro estranea: primo accordo anticipato di 3 s (bug 3); audio tagliato: verde sbagliato (bug 1) |
| A2 falsi positivi | sintetico 0 su 40 tracce; reale: 8 gap (uno visibile), senza verità |
| A3 riga e play nel gap | riga e tempi giusti; in play l'evidenziazione resta ferma (bug 2) |
| B confidenza | verde 100% su 82 sezioni stabili, rosso < 50%, tempo libero mai verde; ma nel tempo libero giallo = da 0% a 100% (bug 7) |
| C rumore, trasposizione, BPM | OK; confine del rumore e tap tempo (bug 5, 6) |
| D1 correzione a orecchio | OK (prossimo accordo, conteggio, annulla fino a 0, salvataggio parziale, tocchi in più) |
| D2 `:disabled` | OK, 11 controlli, tutti attenuati e tratteggiati |
| D3 altezza pannello | OK: uguale da fermo, in play e dopo Stop, in 4 combinazioni × 3 schermi |
| D4 schermata di sincronizzazione | barra fissa, "Fatto" e avvisi OK; testo troncato a 360 e 320 px (bug 4) |
| E prestazioni ×4 | 13,1–13,4 s; frame più lungo 163 / 264 / 176 ms (bug 8) |
| F regressione | vedi sezione F |
| F prova da utente | completata su SE e 13 senza blocchi; attriti elencati |

## A. Audio con musica non nel foglio

Generatore mio con semi 5, 17, 42 (l'implementatore ha usato 3, 11, 29). Foglio da 61 eventi, 8 sezioni, 137 s; la sezione 3 ("Free") è a tempo libero con arpeggio e la escludo dai conteggi "stabili". Gap veri = musica estranea inserita; "una qualsiasi copia ammessa" per le parti ripetute.

| caso (3 semi) | stabili entro 100 / 250 / 500 ms | gap trovati rispetto ai veri | colori sezioni (seme 5 / 17 / 42) |
|---|---|---|---|
| controllo | 100 / 100 / 100% | nessuno (giusto) | gggrgggg / gggygggg / gggrgggg |
| intro estranea di 15 s | 98,2 / 98,2 / 98,2% | nessun gap iniziale; primo evento 3,06–3,08 s prima del vero in tutti i semi | gggygggg / gggygggg / gggrgggg |
| assolo di 20 s tra Verse e Chorus | 100% | 46,5–66,5 vero; trovato 46,5–66,5 (errore 0,0 s) in tutti i semi | gygygggg / gygygggg / gygrgggg |
| ritornello finale ripetuto 2 volte | 100% | lungo 36 s giusto; esatto in 1 seme su 3, negli altri due spostato indietro di una copia (18 s: la copia è identica, equivalente) | gggrgggg / gggygggg / gggrgggg |
| Bridge ripetuto 1 volta | 100% | esatto in 1 seme su 3; negli altri spostato di una copia (10,9 s) | gggrgggg / gggygggg / gggrgggg |
| Verse 2 (periodico) ripetuto 1 volta | 100% | esatto in 1 seme; negli altri spostato di una copia (16 s) | gggrgggg / gggygggg / gggggggg |
| fine sfumata (15 s) | 100 / 100 / 100% | nessuno (giusto) | come il controllo |
| audio tagliato al 70% | 83,3 / 83,3 / 83,3% (seme 5; 81,1% e 83,3% negli altri) | – | gggrgrrr / gggygrrr / gggrgrrr |

Lettura: sul tempo stabile la musica in più viene assorbita bene e il gap ha inizio e fine esatti quando non c'è ambiguità. Con copie identiche il gap può cadere prima o dopo la copia: la differenza non si sente ed è accettabile. Due difetti:

- **Audio tagliato**: non ci sono gap veri, ma gli eventi dopo il taglio vengono schiacciati e, peggio, quelli prima del taglio vengono trascinati (bug 1).
- **Intro estranea**: nessun gap iniziale; il primo accordo del foglio viene steso sulla coda dell'intro (bug 3).

Prova di taglio più ampia (`round8-tester-cut.mjs`: 5 semi × tagli al 50, 60, 70, 80, 90%): sezioni verdi con più del 10% dei cambi udibili sbagliati di > 250 ms: **6 su 25 tagli** (taglio al 70%: la sezione 4, 8 cambi con 5 sbagliati di 1,5–8 s, verde in 3 semi su 5 e con confidenza di evento 1,00; al 50% una sezione di 12 cambi con 7 sbagliati, verde, in un seme).

**A2 falsi positivi.** Sintetico normale: 8 semi × 5 varianti (pulito, senza batteria, senza voce, rumore 0,15, 2 accordi mancanti) = 40 tracce, **0 gap ≥ 3 s** (e 0 gap ≥ 1 s nei controlli A). Reale (mp3 da 513,6 s, 328 eventi, calcolo 2,3 s in Node): **8 gap ≥ 1 s**, tutti al confine tra un Chorus e un Verse (lunghi 4,2 / 2,6 / 2,4 / 2,6 / 2,6 / 2,4 / 1,8 / 2,1 s): a 0:59,3–1:03,5 (tra Verse 1 e Chorus 1), 1:25,9–1:28,4, 2:41,7–2:44,0, 3:57,8–4:00,4, 4:55,4–4:58,0, 5:14,8–5:17,2, 6:32,5–6:34,3, 7:37,0–7:39,1. L'interfaccia ne mostra solo uno (≥ 3 s), «0:59–1:03: parte non presente nel foglio». Non ho una verità sul reale: possono essere pause vere tra le sezioni o assorbimento di tempo libero; non lo so dire senza ascolto (vedi "Non verificato"). Nessun evento dura più di 12 s.

**A3 nell'app** (mp3 con assolo di 20 s, iPhone SE): la riga «0:46–1:06: parte non presente nel foglio» compare tra Verse e Chorus, subito sopra la sezione che segue, con i tempi giusti (vero 46,5–66,5; salvato 46,6–66,5). Durante il play nel gap l'utente vede (screenshot `gap-SE-solo-play-mid-gap.png`): l'ultimo accordo del Verse (G) resta evidenziato per tutti i 20 s, la barra dell'accordo resta piena, il blocco «POI C 1» dice che il prossimo accordo arriva tra un battito, la nota fissa sui BPM resta sotto; nessun testo dice che si sta suonando fuori dal foglio (bug 2). Passato il gap l'evidenziazione salta al Chorus (eventi 19, 20, 21 a tempo). Vicino al gap la sezione precedente perde il BPM: da «sicura · 120 BPM» a «da controllare · tempo libero» (bug 9).

## B. Confidenza

Banco mio (`round8-tester-b.mjs`, `round8-tester-bench.mjs`, 3 semi × 7 tracce = **114 sezioni, 930 cambi**): accordi che condividono note (C Am Em G F), cambi da 1 battito, rubato (tempo con deriva fino a ±24%), tempo libero con arpeggio (durate 1,4–3,8 s), rumore bianco a SNR 10 e 3 dB, tracce miste. Quota dei cambi entro 250 ms, per stato:

| gruppo | stato | sezioni | cambi | entro 250 ms | peggiore sezione |
|---|---|---|---|---|---|
| con battito stabile | verde | 82 | 704 | 100,0% | 100% |
| con battito stabile | giallo | 0 | – | – | – |
| con battito stabile | rosso | 0 | – | – | – |
| tempo libero | verde | 0 | – | – | – |
| tempo libero | giallo | 30 | 214 | 74,8% | 0% |
| tempo libero | rosso | 2 | 12 | 41,7% | 17% |

Per tipo generato: stabili 63 sezioni 100% (tutte verdi); cambi da 1 battito 18 sezioni 100% (15 verdi, 3 gialle perché senza battito riconosciuto); **rubato 18 sezioni 100% esatte ma 14 gialle** (riconosciute come tempo libero: troppo prudente, ma sicuro); tempo libero con arpeggio 15 sezioni, 27,4% (13 gialle, 2 rosse).

**Verde sbagliato.** Cercato di proposito:
- sul banco sopra: nessuno (82 sezioni verdi, minimo 100%);
- banco avversario (`round8-tester-b2.mjs`: cambi anticipati di mezzo battito o di un battito, in ritardo di 1/4 e 1/2 battito): 40 sezioni verdi su 40; una sola sotto il 90% (anticipo di un battito, seme 3: 88%, un cambio su 8 sbagliato con confidenza 1,00); errore mediano 8–49 ms: il motore segue l'attacco e non la griglia;
- **audio più corto del foglio** (A sopra): sì, **6 casi su 25** (bug 1). È il caso peggiore trovato.

Requisiti: verde ≥ 90% entro 250 ms: sì sul banco (100%); rosso < 50%: sì (41,7% sul tempo libero, nessun rosso a tempo stabile); tempo libero mai verde: sì (0 su 32). Zona intermedia: il giallo del tempo libero non separa nulla (da 0% a 100% per sezione; dieci sezioni su 15 con arpeggio sono giuste al ≤ 20% e gialle o rosse con confidenza 0,35–0,55).

**Monotonia** (correlazione di rango tra confidenza dell'evento ed errore, `n=930`): −0,114 su tutti gli eventi, +0,028 sui soli stabili (quasi tutti a confidenza ≈ 1 ed errore ≈ 0: tanti pareggi), +0,034 sul tempo libero (nessun legame), −0,001 con rumore a 3 dB, +0,096 sul rubato. A livello di classi la quota entro 250 ms cresce: 0,00–0,20: 18% (17 eventi); 0,20–0,40: 74%; 0,40–0,55: 75%; 0,55–0,75: 84% (nel tempo libero 33%); ≥ 0,75: 100%. Quindi le confidenze **sono monotone a classi, ma non per rango dentro il tempo libero**: lì la confidenza non dice quali eventi sono giusti (bug 7).

## C. Rumore, trasposizione, BPM

Motore (`round8-tester-c.mjs`) e app (`round8-tester-c-app.cjs audio`, iPhone SE, mp3):

| ingresso | messaggio | salvataggio | trasposizione proposta |
|---|---|---|---|
| rumore bianco 150 s | «Audio non riconosciuto: è il brano giusto?…» | no | no (margine/punteggio 0,042) |
| rumore bruno 150 s, rumore a −60 dB | non riconosciuto | no | no |
| silenzio | non riconosciuto | no | no |
| altro brano (altri accordi) | non riconosciuto | no | no (0,038) |
| brano giusto pulito | pronta, 8 sezioni | sì | no |
| brano giusto + rumore bianco SNR 20 / 10 / 5 / 0 dB | pronta, 100% dei cambi stabili entro 250 ms | sì | no |
| SNR −5 dB | pronta (colori gygryggg), 100% | sì | no |
| **SNR −10 dB** | **non riconosciuto**, ma 100% dei cambi stabili entro 250 ms | no | no |
| rumore rosa SNR 5 / 0 dB | pronta (0 dB: yyyrygyg), 100% | sì | no |
| **rumore rosa SNR −5 dB** | **non riconosciuto**, ma 100% entro 250 ms | no | no |

Il confine sta tra −5 e −10 dB con rumore bianco e tra 0 e −5 dB con rumore rosa. Sotto quel punto l'allineamento resta preciso ma il brano viene rifiutato, senza modo di forzarlo (bug 5, bassa: SNR di −10 dB significa musica quasi inaudibile; lo segnalo perché il compito chiedeva dove sta il confine).

Trasposizione, audio +2 e −5 semitoni (anche +1, −1, +6 sul motore): in tutti i casi la proposta compare con il segno giusto («La registrazione è 2 semitoni sopra il foglio» / «5 semitoni sotto»); «Trasponi il foglio» imposta `transpose` a 2 / −5, l'allineamento resta, il foglio mostra A E F#m D (da G D Em C) e D A Bm G, il riquadro diventa «Foglio già trasposto ✓» e un secondo clic non somma.

BPM − / + (iPhone SE, brano sintetico): senza allineamento funzionano (90 → 91); con allineamento sono disattivati e la nota compare; il campo del numero con «Applica» non cambia nulla (resta aperto, senza messaggio proprio); dopo «Scarta» tornano attivi, senza nota; con ancora manuale e senza allineamento funzionano come prima (92 → 93). **Tap tempo con allineamento attivo**: resta attivo e riscrive i BPM della sezione (91 → 237 dopo cinque tocchi a 250 ms) senza effetto sull'audio e senza nota (bug 6).

## D. Correzione a orecchio e interfaccia

**D1** (iPhone SE, brano sintetico, sezione da 12 accordi, tocchi sull'orologio audio):
- prima di ogni tocco «Prossimo: X · mancano N tocchi» e «k / 12 cambi» sono giusti su tutti i 12 tocchi (il singolare «manca 1 tocco» non l'ho provato nell'app: l'ho letto nel codice);
- tocchi in più oltre la fine: il contatore resta 12/12, messaggio «Hai già toccato 12 volte: premi «Anteprima» o «Annulla ultimo tocco»», Salva resta disponibile;
- «Annulla ultimo tocco» ripetuto da 12 a 0: 11 10 … 1 0, poi il pulsante è disattivato, il prossimo torna al primo accordo, Salva e Anteprima disattivati;
- 3 tocchi, 1 annullo: «2 / 12» e prossimo = terzo accordo;
- 7 tocchi su 12: l'anteprima dice «mancano 5 tocchi. Senza tempo (tengono quello automatico): G, Am, F, C, G.», il pulsante dice «Salva (5 senza tempo)»; dopo il salvataggio gli accordi toccati stanno entro 23 ms dai tocchi, i 5 mancanti hanno **esattamente** il tempo automatico (36,59 38,55 40,55 42,59 44,58 s; verità 36,53 38,53 40,53 42,53 44,53), gli eventi restano in ordine, la sezione non è «verificata» (corretto: è incompleta) e resta verde;
- tocchi in ritardo di 1,5 s rispetto ai tempi automatici (6 su 12): il salvataggio è rifiutato con «Gli ultimi tocchi cadono dopo l'inizio automatico degli accordi che mancano: hai saltato un tocco?».
- Il nuovo comportamento (C4a del round 7) è giusto: è meglio salvare un parziale con avviso che bloccare tutto.

**D2** `:disabled`: in 9 schermate (libreria vuota, brano, sincronizzazione senza e con audio, riepilogo, correzione a 0 e 1 tocco, brano con allineamento e menu «altro») ci sono 11 controlli disattivati visibili (Esporta, Annulla ultimo tocco, Anteprima, Salva, BPM − e +): tutti con opacità 0,5 e bordo tratteggiato, senza riempimento. Negli screenshot (`t-SE-corr-open.png`, `t-SE-song-aligned.png`) si distinguono subito da quelli attivi; il testo disattivato ha poco contrasto ma è voluto. Nessun controllo con `aria-disabled` o classe `.disabled` senza l'attributo.

**D3** altezza del pannello (stesso brano reale; px): da fermo = in play (10 campioni in 4 s) = dopo Stop in tutte le combinazioni:

| schermo | senza audio, con ritmo | senza audio, senza ritmo | con audio e allineamento, con ritmo | con audio, senza ritmo |
|---|---|---|---|---|
| 360×740 | 136,5 | 116,5 | 170,5 | 150,5 |
| SE 375×667 | 123 | 103 | 157 | 137 |
| 13 | 123 | 103 | 157 | 137 |

Nota: con l'allineamento il pannello è 34 px più alto (la nota fissa sui BPM, su due righe): 157 px = 23,5% dello schermo di SE.

**D4** schermata di sincronizzazione sul reale (12 righe):
- righe: 54 px a 360, SE e 13; **a 320 px 54–71 px** (alcuni nomi e orari vanno a capo: «Verse 2», «1:28,4»);
- pulsanti ▶ e ✎: 44×44 px; 24 su 24 a posto;
- barra fissa in basso: «Fatto» (48 px) in vista e toccabile a ogni posizione di scorrimento (9 posizioni provate a 320, SE e 360), nessuna copertura (`elementFromPoint`); la barra occupa circa il 28% dell'altezza a 320×568 (con l'avviso);
- avvisi («Sincronizzazione accettata.», la nota lunga del salvataggio parziale, 69 px): stanno dentro la barra, sopra i suoi pulsanti, la barra è opaca e l'ultima riga può scorrere sopra; nessuna riga coperta;
- **testo troncato**: a 360 px «da controllare · tempo libero» (29 caratteri, 176 px su 161) è tagliato con i puntini in 3 righe su 12; a 320 px sono tagliate 6 righe su 12 («da controllare · t…», «da controllare · 1…», cioè il BPM, che è l'informazione importante) e il nome/orario va a capo; a SE (375) e 13 nessun taglio. Il requisito «testo non troncato a 320 px» non è rispettato (bug 4). Screenshot: `t-320-sync-rows.png`.

## E. Prestazioni (mp3 reale da 513,6 s, iPhone SE, Chromium headless)

CPU ×4 (3 corse, `round8-tester-app.cjs perf SE 4 3`, nessun altro processo attivo):

| corsa | totale (decodifica + analisi) | frame più lungo | frame > 100 ms | frame > 250 ms | task lunghi (massimo) | «Annulla» a metà |
|---|---|---|---|---|---|---|
| 1 | 13,4 s (1,7 + 11,2) | 163 ms | 6 | 0 | 76 (153 ms) | 700 ms |
| 2 | 13,4 s (1,8 + 11,1) | **264 ms** | 7 | **1** | 85 (201 ms) | 677 ms |
| 3 | 13,1 s (1,9 + 10,6) | 176 ms | 9 | 0 | 74 (176 ms) | 693 ms |

Obiettivi del round 8: totale < 14 s (raggiunto con soli 0,6–0,9 s di margine; l'implementatore riporta 11,6 s sulla sua macchina) e frame più lungo < 200 ms (**non in 1 corsa su 3**: bug 8). «Annulla» risponde in circa 0,7 s (round 7: 0,43 s: più lento di prima).

CPU ×6 (informativo, 1 corsa): 18,5 s, frame più lungo 328 ms, 21 frame > 100 ms, 2 > 250 ms, Annulla 958 ms.

Memoria: l'heap JavaScript (`Performance.getMetrics`) resta a 5–7 MB perché l'audio decodificato sta in buffer esterni. Misurando i processi Chromium (RSS somma): 560 MB prima, **picco 973 MB (+413 MB)** durante decodifica e analisi, 578 MB un secondo e mezzo dopo. Su un iPhone con poca memoria libera (stima mia, non provato su iOS) il picco potrebbe far scartare la scheda; è una cosa da guardare, non un bug dimostrato.

## F. Regressione e prova da utente

`npm test`: 210/210 verdi (13 s). E2E rilanciati sul build del round 8 (`regress.sh`, log in `test-artifacts/round-8/regress.log`): `round4.cjs` 44 PASS; `round5.cjs all` 66; `round6.cjs` real/audio/height 16+6+3; `round7-panel` 9; `round7.cjs flow` 15 su 360, SE e 13; `round7-tester-a` 39; `-core` 3; `-engine all` 27; `-robust-app` senza errori; `-app` `cancel` 7 e `persist` 5; `round6-tester-browser` 60; `-fuzz` 8; `round5-tester-core` 28, `-browser` 25, `-text` 8; `round8.cjs all` 29 PASS su 360, SE e 13; i miei `round8-tester-*` come sopra. Tutti verdi tranne:
- `round7-tester-app.cjs synth`: **C3c** («evidenziazione dal vivo nella sezione libera entro 250 ms», media 670 ms) fallisce, e subito dopo lo script va in timeout perché C6b preme «+» del BPM, ora disattivato («element is not enabled»). Entrambi sono comportamenti voluti dal round 8: C3c era già un «punto debole atteso» e ora la sezione è gialla o rossa con confidenza < 0,6; C6b è il bug 3 del round 7, risolto. Nuovo controllo in `round8-tester-updated.mjs` (5 semi: sezione libera mai verde e ogni cambio sbagliato di > 250 ms ha confidenza < 0,6: ALL PASS); il BPM bloccato è in `round8-tester-c-app.cjs bpm` (B1–B4).
- `round7-tester-app.cjs correct`: **C4a** («con un tocco saltato non si può salvare») fallisce perché ora si può salvare un parziale. Il nuovo comportamento è giusto (D1g–D1i sopra: tempi automatici esatti per i mancanti, tocco in ritardo rifiutato con messaggio).
- `round6-tester-core.mjs` A1: 2 FAIL come nei round 6 e 7 (tabella del report del round 6 cambiata dalla regola della levare).
Non rieseguiti: `round7-tester-user` (sostituito da `round8-tester-user`), `round7.cjs perf` e `round7-tester-app perf` (sostituiti dalla sezione E), `round4-tester-audio` (> 10 minuti).

**Prova da utente** (solo tocchi veri, SE 375×667 e iPhone 13 390×664, brano e mp3 reali, `round8-tester-user.cjs`): libreria vuota → importa (0,2 s) → «Sincronizza audio» → mp3 → «Sincronizza automaticamente» (a y = 327, 325×64: visibile senza scorrere) → riepilogo dopo 3,7–3,8 s → «Ascolta e controlla» (riga «Verse 1 · Em») → correzione della sezione più gialla (la prima, «Verse 1», confidenza 0,43, 35 accordi) con 35 tocchi su «Cambio!» (351×187 e 366×186 px; scarto medio −8 ms) → Salva → «6 sicure · 5 da controllare · 0 incerte · 1 verificate a orecchio» → esporta → Accetta → Fatto → Play (allineato) → durante il play tocco su un accordo di metà brano (il 164° su 328, a 256,3 s): il play salta lì (258,8 s dopo 2,5 s). In tutto 76–77 s, nessun errore di pagina, **nessun punto in cui mi sono bloccato**. Cosa non si capisce o attrita:
- il riepilogo parla di «sicure / da controllare / incerte / verificate a orecchio» ma non dice cosa fare: «Ascolta e controlla» e «Accetta» e «Fatto» sembrano tre modi di finire; «Accetta» sta in alto (con la barra fissa sotto la lista, dopo l'esporta serve scorrere indietro: y = −600);
- «tempo libero» e «da controllare · tempo libero» non spiegano cosa significhi per chi suona; 6 sezioni su 12 sono gialle e il BPM, l'informazione che ci si aspetta, manca proprio in quelle;
- la riga «0:59–1:03: parte non presente nel foglio» sul reale è fra Verse 1 e Chorus: l'utente non sa se è un errore dell'app o una pausa vera, e non c'è un modo per scartarla;
- «Calcolo: decodifica 1.3 s, analisi 2.2 s» è un dettaglio tecnico nel riepilogo;
- la barra fissa con avviso occupa circa un terzo dello schermo di SE: nel riepilogo si vedono 3–4 righe alla volta;
- nella schermata di correzione con 35 accordi (SE e 13) la riga «Tocca «Cambio!» a ogni cambio d'accordo (sono 35, il primo compreso)» è tagliata dal pulsante «Cambio!» (screenshot `u8-user-SE-09-correct-open.png`, bug 10);
- il pannello del brano con l'allineamento è alto 157 px a SE con la nota sui BPM: la nota occupa due righe per sempre.

## Bug, per gravità

1. **Media — audio più corto del foglio: sezioni verdi con la maggior parte dei cambi sbagliati.** Con l'audio tagliato al 70% (5 semi) il Verse 2 ha 5 cambi su 8 sbagliati di 1,5–8 s e il colore è verde in 3 semi su 5, con confidenza di evento 1,00 (gli ultimi due cambi). In 25 tagli (50–90%) 6 sezioni verdi hanno più del 10% dei cambi udibili sbagliati di > 250 ms. Il motore distribuisce i cambi dopo il taglio comprimendoli anche su tratti dove il foglio continua. È il "verde sbagliato" peggiore trovato: l'utente non lo controllerebbe. Script: `test/e2e/round8-tester-cut.mjs`; test `todo` in `test/regression/round8-tester.test.js`.
2. **Bassa — musica in più nel brano: durante il play l'evidenziazione resta ferma e dice «tra un battito» per tutta la durata.** Con un assolo di 20 s: G resta acceso, «POI C 1», nessuna indicazione di essere fuori dal foglio (limite dichiarato dall'implementatore). L'utente pensa che l'app si sia bloccata. Script `round8-tester-gap-app.cjs`; screenshot `gap-SE-solo-play-mid-gap.png`.
3. **Bassa — intro estranea (15 s): il primo accordo parte 3 s prima del vero, con confidenza 1,00, e non c'è gap iniziale.** Tre semi su tre (3,06–3,08 s). Il resto è a posto (98,2% sulle parti stabili). Test `todo`.
4. **Bassa — sincronizzazione a 360 e 320 px: testo troncato.** «da controllare · tempo libero» tagliato a 360 px (3 righe su 12); a 320 px 6 righe su 12 perdono il BPM, nome e orario vanno a capo (righe da 54 a 71 px). Il compito chiedeva «testo non troncato a 320 px». `round8-tester-app.cjs sync 320`.
5. **Bassa — brano giusto con tanto rumore rifiutato anche se allineato al 100%.** Rumore bianco a −10 dB e rosa a −5 dB: «Audio non riconosciuto», nessun salvataggio, nessun «usa comunque». Confine tra −5 e −10 dB (bianco) e tra 0 e −5 dB (rosa). Test `todo`.
6. **Bassa — tap tempo con allineamento attivo riscrive i BPM senza effetto e senza nota.** 91 → 237 dopo cinque tocchi. È il bug 3 del round 7 su un pulsante rimasto attivo (l'implementatore ha lasciato il tap tempo com'era). `round8-tester-c-app.cjs bpm`.
7. **Bassa — tempo libero: la confidenza non separa gli eventi giusti da quelli sbagliati.** Sezioni con arpeggio: 30 gialle, giuste dal 0% al 100%; correlazione di rango 0,034; dieci su 15 con arpeggio sono giuste ≤ 20% e hanno confidenza 0,35–0,55 (gialle o rosse). Limite dichiarato; il "mai verde" regge. Il rosso, quando c'è, è sotto il 50%. Il rubato è invece troppo prudente (14 su 18 sezioni giuste al 100% ma gialle «tempo libero»).
8. **Bassa — prestazioni a ×4 raggiunte di poco e non in modo stabile.** 13,1–13,4 s (obiettivo < 14); frame più lungo 163 / 264 / 176 ms (obiettivo < 200 ms non in 1 corsa su 3); «Annulla» 0,7 s (era 0,43 s). A ×6: 18,5 s e frame 328 ms. Picco di memoria di processo +413 MB (non provato su iOS).
9. **Cosmetico — una sezione adiacente a un gap perde il BPM.** Verse a 120 BPM «sicura» diventa «da controllare · tempo libero» (seme 5, 17 e 42, assolo di 20 s subito dopo), anche se i suoi cambi sono tutti entro 250 ms.
10. **Cosmetico — correzione a orecchio con molti accordi: la riga delle istruzioni è coperta in parte dal pulsante «Cambio!».** Con 35 accordi su SE e 13; con 12 no. Anche: l'anteprima dice «mancano 1 tocchi» (singolare non gestito, riga 126 di `src/ui/correct.js`; l'etichetta «Prossimo» invece lo gestisce).

## Test dei difetti aperti

`test/regression/round8-tester.test.js` (`node --test "test/regression/*.test.js"`, fuori da `npm test`) contiene 3 test `todo`: bug 1 (taglio al 70%, nessun verde con più del 10% sbagliato), bug 3 (intro estranea, primo evento entro 0,5 s), bug 5 (SNR −10 dB riconosciuto se allineato). I bug 2, 4, 6, 7, 8, 9 e 10 sono dell'interfaccia o statistici: li coprono gli script e2e sopra.

## Non verificato

- Le 8 pause tra Chorus e Verse del reale (una sola visibile): senza verità e senza ascolto non so se siano giuste.
- Dispositivo reale (iOS, Safari, memoria, decodifica): tutto in Chromium headless; il picco di +413 MB non è provato su iPhone.
- Rumore di tipo musicale (altra musica sopra) e microfono: provato solo rumore bianco, rosa e bruno.
- Audio più lungo con tempo libero in mezzo e con più di un gap contemporaneo.
- «Usa durate e BPM misurati» e importazione/esportazione della libreria con un gap.
