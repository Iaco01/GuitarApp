# Round 10 — Report del tester

Verifica indipendente del round 10: un tic per quarto con la sincronizzazione (A), ritocco rapido di un accordo o di una sezione (B), sezioni tolte / tagli / assolo sul reale (C), testi e interfaccia (D), regressione, prestazioni e prova da utente (E). Nessun testo del brano reale è riportato: solo conteggi, tempi, nomi di sezione e di accordi. Ho misurato prima di leggere i numeri dell'implementatore (il suo report l'ho letto solo per i confronti). L'audio derivato e i log stanno in `test-artifacts/round-10/` (non versionato); gli screenshot (`real/`, `texts/`) mostrano il testo e non vanno committati; li ho guardati (SE e 320 px: foglio di ritocco, correzione a 35 accordi, riepilogo, gap in play).

Il reale è `test/fixtures/local/american-pie.{mht,mp3}`: 513,7 s, 12 sezioni, 328 accordi, 1 gap (59,3–63,5 s). Il «round 9» di confronto è `8b86705` in un worktree temporaneo (`git worktree add /tmp/r9wt 8b86705`, poi rimosso).

Script nuovi (tutti in `test/e2e/`, più due file di test `todo`):

| file | contenuto |
|---|---|
| `round10-tester-clicks.cjs` + `-clicks-analyse.mjs` | A1: tutto il reale (513 s) in play su SE con il clic acceso; intercetta ogni oscillatore (`AudioContext.createOscillator().start`) e le coppie di orologi (ctx / audio); per accordo: tic, quarti, spaziatura, accento |
| `round10-tester-make.mjs`, `-clicks-synth-analyse.mjs` | A2/A3: sintetico con accordi da 1, 2, 3, 4, 8 quarti (il foglio dice 4 ovunque) e una sezione a tempo libero; errore dei tic contro la griglia vera |
| `round10-tester-tempo.mjs`, `-phase.mjs` | A1: controllo indipendente del BPM misurato (autocorrelazione dell'inviluppo) e posizione dei tic sugli attacchi |
| `round10-tester-noalign.mjs` | A6: senza allineamento, migrazione schema 2 |
| `round10-tester-real.cjs` (`coherence`, `loop`, `gap`, `user`) | A4, B3, E3: coerenza contatore/punti/badge con i tic, loop, ritocco accanto al gap reale, prova da utente su SE e 13 con gesti `hasTouch` via CDP |
| `round10-tester-nudge.cjs` (`flow`, `limits`, `gesture`, `conflict`, `corr`) | B1–B6 sul sintetico: scope, ±0,25/±0,05, Ascolta, Annulla, reload, 20 tocchi, primo/ultimo accordo, gesti, conflitti |
| `round10-tester-realcut.mjs`, `-real-vs-r9.mjs` | C1–C3, C5: reale con sezioni tolte / ripetute / tagliato / assolo, confronto con il round 9 evento per evento |
| `round10-tester-texts.cjs` | D: riepilogo e correzione a 320, 360, SE, 13: testi tagliati, altezze, barra fissa |
| `test/regression/round10-tester.test.js`, `round10-tester-real.test.js` | 8 test (5 + 3 `todo`) per i difetti aperti; non girano con `npm test` (non è nel suo glob) |

## Esito

| Punto | Esito |
|---|---|
| A1 un tic per quarto, reale intero (328 accordi, 1095 tic) | **conteggio coerente con i quarti** (327/328 uguali, 1 con più tic: un accordo di 0,21 s), nessun accordo senza tic, 0 tic nel gap, accenti ogni 4 tic in tutte le 12 sezioni (278/278 sul primo tempo della timeline). **Ma i quarti non sono quelli della musica**: le 4 strofe da 36 accordi hanno gli stessi battiti in 2 posizioni su 36, e la spaziatura dei tic oscilla (bug 9) |
| A1 BPM misurato | confermato dall'autocorrelazione in 6 sezioni stabili su 9 (stesso BPM del picco più forte, scarto ≤ 3); nelle 3 rimanenti (6, 8, 10) il picco più forte è a 2/3 (88–92 contro 136–138): ritmo ternario, non un errore di dimezzamento |
| A2 sintetico 1, 2, 3, 4, 8 quarti | **43 accordi stabili su 44 con il numero esatto di tic** (nella finestra vera dell'accordo); errore dei tic mediano 10 ms, 90% 25 ms, massimo 219 ms (accordo d'intro trovato 0,66 s tardi); 10/155 tic oltre 30 ms. Ma 6/44 accordi hanno `eventBeats` ≠ verità (accordi trovati in ritardo o da 0,5 s) e l'ultimo accordo fa 11 tic invece di 8 |
| A3 tempo libero | ticchettio al tempo della sezione vicina, mediana 0,987 battito (5–95%: 0,86–1,18); non è agganciato alla musica (vedi A3) |
| A4 contatore / punti / badge / loop | OK: 52 cambi del contatore per 53 tic (ritardo mediano 14 ms, massimo 30), tic accentato accende il punto 1 12/12, 10/10 accordi evidenziati con i tic uguali ai loro battiti; loop: 41,5 tic per giro contro 42, ma **un tic perso al riavvolgimento** (bug 11) |
| A5 dopo il ritocco / «Correggi a orecchio» | il primo tic segue il nuovo inizio; **il numero di tic NON segue** il nuovo tempo dopo un ritocco (bug 1); dopo «Correggi» sì |
| A6 senza allineamento | OK: tic = battiti del foglio (stime); schema 2 con durate «default» (50 × 4) riceve le stime `{1:3, 2:21, 3:4, 4:8, 6:3, 7:1, 8:7, 10:3}`; reale non allineato `{1:15, 2:85, 3:7, 4:131, 5:2, 6:68, 8:18, 10:2}` |
| B1 ritocco su SE e 13 | tempi salvati esatti (±0,25 / ±0,05, «Solo questo» / «Questo e i seguenti»), Annulla, Ascolta (parte a −2 s, si ferma a +1,92 s), persistenza al reload; **ma tre difetti** (bug 2, 3, 4) |
| B3 limiti | 20 tocchi di −0,25: mai ordine invertito, mai accordo < 0,1 s, messaggio «Non c'è spazio per spostare di più», Annulla ripristina esattamente (primo, ultimo, centrale, ±); ma **2–4 tic in 0,1 s** (bug 1) |
| B5 conflitti | «Rifai» chiede conferma dopo un ritocco; «Sposta tutto» coerente (±0 ms); «Correggi» parziale dopo un ritocco ok; **ancore: il ritocco della sezione è assorbito** (bug 13); **ritocco accanto al gap: il gap sparisce** (bug 2) |
| B6 gesti `hasTouch` | scorrimento col dito che parte su un accordo: ok; pressione lunga sull'intestazione per il loop: ok; **pressione lunga su un accordo: il rilascio preme il pulsante sotto il dito** (bug 4) |
| C1 reale con sezioni tolte | 6 sezioni singole: tutte segnate «non presente» giuste, 0 verdi sbagliati; coppie di sezioni uguali: la saltata non è quella tolta, ma segnalata (giallo, bug 8); «prime 60 s tolti»: bug 5 |
| C2 reale tagliato 20, 30, 45, 70% e −60 s | 30% e 70% ok; **20% non riconosciuto** (bug 7); **45%: sezione 6 verde con 11/11 cambi 2,7–3,7 s in anticipo** (bug 6); −60 s e −60 s + taglio: bug 5 |
| C3 assolo al posto di una sezione, reale | 4 prove: 3 non segnate «non presente» (rossa o gialla, 16–20 cambi sul testo sbagliato), 1 sì; nessun verde sbagliato |
| C4 tempo libero (banco del round 9) | giallo 85,6% (≥ 75 ✓), mai verde ✓, **rosso 52,4% (< 50 ✗)** (bug 16) |
| C5 reale intero contro il round 9 | **328/328 identici, differenza massima 0,000 s**; un solo cambio: sezione 12 da incerta a da controllare (confidenza 0,30 contro la nuova soglia) |
| D testi e interfaccia | nessun testo tagliato a 320/360/SE/13, nessun overflow orizzontale, righe 54–94 px; **a 320×568 il bottone «Cambio!» sta quasi tutto dietro la barra** (bug 14) |
| E1 regressione | `npm test` 250/250; e2e vedi E1 |
| E2 CPU ×4 | totale 13,0 / 13,1 / 14,0 s (round 9 nello stesso momento: 12,4 / 13,6 / 12,9), frame più lungo 104 / 135 / 108 ms (89 / 119 / 86); vedi E2 |
| E3 prova da utente | completata; esitazioni in E3 |

## A. Metronomo: un tic per quarto con la sincronizzazione

### A1. Il reale intero, in play su SE, clic acceso

Metodo: ogni `createOscillator().start(when)` registra `when` (orologio del `AudioContext`), la frequenza (1000 Hz = accento) e, ogni 100 ms, la coppia (orologio ctx, `audio.currentTime`); il tempo-audio di un tic è `when` + mediana (audio − ctx) entro ±2 s. Il ritardo fra l'inizio di un accordo e il suo primo tic è 0 ms (IQR 1 ms): i tic partono dove la timeline dice. I «quarti» di un accordo sono `durata × BPM misurato / 60` (BPM della sezione; nelle sezioni libere quello della sezione vicina). Brano intero in 8 minuti, 0 errori di pagina.

| misura | valore |
|---|---|
| accordi presenti / coperti dal play | 328 / 328 (0 saltati) |
| tic registrati | 1095 (in 513 s) |
| tic − arrotondato(quarti) | 0 in 327 accordi, +1 in 1 |
| accordi con più tic dei loro quarti (n > q + 0,5) | **1** (sezione 7, accordo di 0,21 s = 0,49 quarti con 1 tic) |
| accordi con meno tic dei quarti / con 0 tic | 0 / 0 |
| tic più vicini di 0,6 × battito | **1** (0,49 battito, ai confini fra due accordi; lo stesso accordo di 0,21 s) |
| tic doppi ai confini degli accordi | 1 (idem) |
| intervalli fra i tic (sezioni stabili) | mediana 0,999 battito; 5–95%: 0,85–1,22; **17%** oltre ±15%, 2% (14 su 737) oltre ±25%, 13 oltre ±40% |
| accenti | 278, tutti su un primo tempo della timeline; ogni sezione ha gli accenti a distanza costante di 4 tic |
| tic nel gap 59,3–63,5 s | 0 (ultimo tic 58,61 s, ripresa a 63,46 s); ultimo tic del brano 508,23 s (fine allineamento 508,66 s) |

Le colonne «più tic dei quarti», «più vicini di 0,6» e «doppi» sono quasi circolari: il numero di tic di un accordo è `round(quarti)`, quindi coincide con i quarti per costruzione. La domanda utile è se i quarti sono quelli della musica. Tre misure indipendenti:

1. **Le sezioni sorelle.** Le quattro strofe da 36 accordi (sezioni 3, 5, 7, 9) hanno la stessa musica; `eventBeats` coincide nelle quattro per **2 posizioni su 36** (i valori vanno da 1 a 8: per esempio `5/4/5/4`, `5/5/5/3`, `4/5/7/5`, `5/8/8/7`). I ritornelli da 16 accordi (4, 6, 8, 10): 9 su 16. Distribuzione dei quarti per accordo (stabili e liberi): 1:18, 2:77, 3:37, 4:47, 5:28, 6:3, 7:5, 8:8, 9:1; 70 accordi stabili su 224 (31%) sono da 3, 5 o 7 quarti, e 102 su 224 (46%) distano più di 0,25 quarti da un intero. Gli accordi sono trovati entro ±250 ms (verde) = ±0,6 battiti a 138 BPM: l'arrotondamento a quarti rende ±1 tic in molti accordi.
2. **BPM.** Autocorrelazione dell'inviluppo del segnale filtrato (`round10-tester-tempo.mjs`): il BPM misurato coincide con il picco più forte nelle sezioni 2, 3, 4, 5, 7, 9 (scarto ≤ 3 BPM; forza del BPM misurato 0,91–1,00 del picco); nelle sezioni 6, 8, 10 il picco più forte è a 88–92 BPM (= 2/3 di 136–138: ritmo ternario), con il BPM misurato a 0,56–0,84 del picco. Nessun dimezzamento o raddoppio. Il BPM dell'app è plausibile.
3. **Fase.** `round10-tester-phase.mjs` (inviluppo agli istanti dei tic contro lo stesso spostato di mezzo battito): rapporto 0,68–1,32, cioè **non distinguibile dal caso** su questo audio (chitarra e voce con attacchi deboli). Non posso confermare che i tic cadano sui battiti veri: lo dichiaro come non verificato.

Effetto per l'utente: il numero di tic per accordo si riparte ad ogni accordo (da `inizio accordo` con passo `durata / n`), non su una griglia fissa. Il passo oscilla da 0,75 a 1,5 battiti (a 138 BPM: da 330 a 650 ms): un clic «ballerino» che si riaggancia ad ogni cambio. Il test sulle sezioni sorelle indica che in circa metà degli accordi il numero dei tic è sbagliato di ±1 rispetto a ciò che suona.

Il pannello mostra «♩≈142,5» in una sezione che nella schermata di sincronizzazione ha 141,4 BPM misurati (il pannello calcola battiti/durata della sezione, non il BPM misurato: scarto 1,1 BPM, bug 12).

### A2. Sintetico con durate note

Brano sintetico (6 sezioni, 50 accordi; 100, 100, 92, libero, 120, 100 BPM; accordi da 1, 2, 3, 4, 8 quarti, il foglio dice 4 per tutti). Si misura il numero di tic nella finestra vera di ogni accordo e l'errore dei tic contro la griglia vera:

- **43 accordi stabili su 44** con il numero giusto di tic nella finestra vera; l'unico errore è il primo accordo (vero 4, 3 tic: l'engine lo trova a 1,86 s invece di 1,20, confidenza 0,81 verde).
- errore di tempo dei tic (tolto lo sfasamento dell'orologio, 35 ms): mediana 10 ms, 90% 25 ms, massimo 219 ms; oltre 30 ms: 10 tic su 155 (tutti negli accordi trovati in ritardo). Richiesto < 30 ms: **non vale per tutti i tic**, vale per il 94%.
- `eventBeats` misurato contro la verità: 6 accordi su 44 sbagliati (#0: 3 contro 4; #25: 3 contro 2; #26: 7 contro 8; #41: 2 contro 1; #42: 1 contro 2; #49: 11 contro 8). Gli ultimi due non sono errori dell'engine ma di inizio-accordo trovato a 0,5 s da un accordo da un quarto; il tic compensa perché la spaziatura resta quella di `durata/n` (nella finestra vera il conteggio torna).
- **Ultimo accordo**: 11 tic invece di 8: il suo tempo arriva fino alla fine dell'audio (il sintetico ha 2 s di coda silenziosa). Nel reale l'ultimo accordo è in una sezione a tempo libero e l'ultimo tic è a 508,2 s su 513,7 (bug 10).

### A3. Tempo libero

Cosa si sente: nelle sezioni senza BPM (reale: 1, 11, 12; sintetico: 4) i tic vanno al BPM della sezione vicina che ne ha uno (l'intro del reale a 100,9 BPM, le due ultime a 135,9) e **si riagganciano ad ogni cambio di accordo** (stessa regola `durata / round(durata × BPM / 60)`). Misure: reale, intervalli 0,987 battiti mediana, 5–95% 0,86–1,18, 9 su 356 oltre ±25%; sintetico, 23 tic in 15,3 s, spaziatura mediana 623 ms, minima 612, massima 905, tic per accordo `2/2/5/5/5/4` contro durate vere `1,4/1,7/3,6/3,1/3,0/2,6` s. È un clic regolare al tempo vicino, non agganciato alla musica: utile come guida, da non scambiare per il battito del brano; il pannello non lo dice. Il tempo libero rimane giallo o rosso e la riga spiega «i cambi sono stimati».

### A4. Riga del ritmo, contatore, loop

(`round10-tester-real.cjs coherence,loop`, SE, sezione 3, 141,4 BPM misurati, 22 s di play.) 52 cambi del contatore di battiti per 53 tic, ritardo del contatore dopo il tic mediana 14 ms, 90% 24 ms, massimo 30 ms. Il tic accentato (1000 Hz) accende il primo punto della riga del ritmo 12 volte su 12. Per 10 accordi evidenziati di seguito, i tic uditi mentre l'accordo è evidenziato sono uguali ai suoi battiti (10/10); il badge «battiti al cambio» assume 1…8. Nel gap: 0 tic, pannello «Fuori dal foglio», «Riprende tra N s con «G»», tempo «♩–» (su SE: 4, 3, 2, 1). Loop sulla sezione 4 (42 battiti, 19,2 s): 91 tic in 41,5 s (2,16 giri) = 41,5 tic per giro; nessun tic più vicino di 0,6 battiti; **un intervallo di 896 ms (2,05 battiti) al riavvolgimento**: un tic manca all'inizio del nuovo giro (bug 11). Conto alla rovescia in modalità audio: non c'è (il conteggio iniziale esiste solo con il metronomo senza audio).

## B. Ritocco rapido

Sintetico `round10-tester-make.mjs` (6 sezioni, 50 accordi, allineato con l'mp3), SE e 13, tocchi veri con `Input.dispatchTouchEvent`.

**B1.** Pressione lunga (700 ms) su un accordo: il foglio si apre su SE e su 13 (una sola scheda, nessun diagramma accordo sopra). «Solo questo accordo» +0,25 sposta quell'accordo di 250 ms e nessun altro; poi −0,05: 200 ms in tutto; la sezione diventa «verificata»; «Questo e i seguenti» sposta 3 accordi su 3 (da j alla fine della sezione); ordine sempre crescente; Annulla (6 volte di fila) ripristina i tempi esatti (anche `verified`); «Ascolta da qui»: SE 0,6 s dopo il tocco la posizione è 32,42 (attesa 32,50), si ferma in pausa a 35,82 (chiesta fine 35,90); 13 idem. Dopo il reload i tempi ritoccati sono salvati; nel JSON della libreria, i tempi e il gap sopravvivono (test pure in `round10-tester.test.js`). Su SE, ritocco di una sezione dalla riga: 12 accordi su 12 −0,05, nessun altro.

**B2. Si trova senza istruzioni?** No, in tre punti:
- il **⇄ nell'intestazione non compare** dopo la sincronizzazione né dopo aver riaperto il brano (bug 3): `onClose` del foglio di sync chiama `buildBody()` prima di `loadAudio()`; il pulsante appare solo dopo un'altra ricostruzione del foglio (per esempio «collassa le ripetizioni»). Sul reale: 0 su 12 intestazioni;
- la riga della schermata di sincronizzazione si apre toccando il **testo** («Mix A 0:18,0 sicura 100 BPM»): non ha icona, né etichetta; c'è solo un `title` che sul telefono non si vede (bug 15);
- la pressione lunga su un accordo non ha nessun suggerimento scritto in tutta l'app (nessuna frase, nessun primo avviso); la sola cosa che ci avvicina è la pressione lunga sull'intestazione per il loop, anch'essa senza avviso.

**B3. Limiti** (20 tocchi per ogni caso, SE):

| caso | spostamento ottenuto | durata minima | messaggio | ordine | Annulla ×20 |
|---|---|---|---|---|---|
| accordo centrale −0,25 ×20 | −0,85 s | 0,100 s | «Non c'è spazio…» | ok | esatto |
| accordo centrale +0,25 ×20 | +1,35 s | 0,100 s | idem | ok | esatto |
| primo accordo −0,25 ×20 | −1,86 s (a 0 s) | 0,492 s | idem | ok | esatto |
| primo accordo +0,25 ×20 | +1,67 s | 0,100 s | idem | ok | esatto |
| ultimo accordo −0,25 ×20 | −2,31 s | 0,100 s | idem | ok | esatto |
| ultimo accordo +0,25 ×20 | +5,00 s (oltre il suo spazio) | 0,492 s | nessuno | ok | esatto |

Dopo i limiti il numero di tic non cambia: **chord 14: 2 tic in 0,100 s** (20 tic/s); primo accordo +: 3 tic in 0,1 s; ultimo −: 4 tic in 0,1 s (bug 1). L'ultimo accordo spostato di +5 s finisce a 116,0 s, oltre la fine dell'audio (111,0 s).

Accanto a un gap (reale, accordo dopo il gap, chord 35): +0,25 e −0,25/−0,05 sul **precedente** vanno; **+0,25 sul successivo allarga il gap (59,3–63,71)**; **−0,05 o −0,25 sul successivo cancella il gap** (bug 2). Accanto a una sezione saltata il ritocco è impedito dall'app («L'accordo non è nell'audio»): confermato dai test unitari del round 10 (non provato in browser).

**B4.** Annulla più volte: ok (6 di seguito, e 25 dopo 20 tocchi); reload: ok; export/import della libreria: il JSON mantiene tempi, `verified` e gap (test pure); l'import normalizza (`normalizeAlignment`) senza perdere nulla nel caso provato.

**B5. Conflitti.**
- **Ritocco e «Rifai»:** dopo un ritocco di sezione il tasto «Rifai» chiede «Rifacendo la sincronizzazione perdi le **1 sezioni** verificate a orecchio. Continuare?» (il ritocco conta come verificata); Annulla nella finestra tiene i tempi (cosmetico: «1 sezioni»; il messaggio parla di «a orecchio» anche per un ritocco).
- **Ritocco e «Sposta tutto»:** con «Sposta tutto +100 ms» attivo un ritocco +0,25 sposta l'evidenziazione di esattamente 250 ms (33,701 → 33,951); il foglio mostra il tempo con lo spostamento (0:33,7).
- **Ritocco e ancore:** su una sezione ancorata il ritocco di un accordo sposta 242 ms invece di 250 (le sezioni sono stirate tra le ancore); **il ritocco dell'intera sezione è assorbito dall'ancora**: +0,25 non sposta il primo accordo (−7 ms) e stira altri 21 accordi: l'utente tocca +0,25 e non succede nulla di visibile (bug 13).
- **Ritocco e «Correggi a orecchio»** sulla stessa sezione: 4 tocchi parziali dopo un ritocco di +0,5 s riportano i 4 accordi toccati vicini al vero (−498…−489 ms) e lasciano gli altri 8 al tempo ritoccato; la sezione resta «verificata» anche con 8 accordi ancora sul tempo ritoccato (cosmetico).
- **Ritocco e nuova sincronizzazione:** chiede conferma (vedi sopra).

**B6. Gesti** (`hasTouch`, CDP):
- scorrimento col dito che parte su un accordo: la pagina scorre di 105 px e non si apre il foglio (SE e 13);
- 6 px di movimento prima dei 500 ms: nessun foglio;
- pressione lunga sull'intestazione per il loop: parte (un `click` segue il rilascio, innocuo);
- **rilascio del dito dopo la pressione lunga su un accordo: il `click` cade sul pulsante che compare sotto il dito**. Con un accordo a metà schermo (SE, y 443–487) il rilascio preme «−0,25 s» (tempo cambiato, 5 volte su 5, anche su 13 se l'accordo è nella fascia); con «Ascolta da qui» il rilascio la preme (si sente partire l'audio); sul reale con l'accordo sulla riga «Questo e i seguenti» il rilascio ha cambiato la scelta (nel foglio compariva già selezionata). Su un dito vero iOS non so se il `click` dopo una pressione lunga arriva (Chromium lo manda); resta un rischio concreto (bug 4);
- un tremolio di 1–3 px durante i 700 ms (il dito vero non sta mai fermo) **annulla** la pressione lunga: `pointermove` la cancella senza soglia. Il `pointermove` di Chromium con tocco di norma è filtrato dentro la tolleranza (circa 10–15 px) ma l'iniezione CDP no: da verificare su un dito vero (bug 4);
- `.ch` ha `user-select: auto` (solo `.sec-head` ha `none`): su iPhone la pressione lunga su un accordo può avviare la selezione del testo.

## C. Correzioni dei bug del round 9 sul reale

Metodo (`round10-tester-realcut.mjs`): audio del reale montato con ffmpeg-in-Node, analisi con il motore corrente (e, per confronto, quello del round 9); verità = tempi dell'analisi del file intero spostati dal taglio. Per ogni caso: sezioni saltate a torto («saltata» ma presente nell'audio), sezioni assenti non saltate, verdi sbagliati (> 10% dei cambi oltre 250 ms), e **quanti eventi cadono su musica di un'altra sezione con testo diverso** (testo evidenziato sbagliato). Colori nell'ordine delle 12 sezioni; intero: `rgygygygggry` (round 9: `rgygygygggrr`).

### C1. Sezioni tolte

| caso | colori (round 10) | saltate | verdi sbagliati | eventi su altra musica (di presenti) | round 9: eventi su altra musica |
|---|---|---|---|---|---|
| senza sez. 3 | `rysgygygygry` | [3] ✓ | 0 | 1/292 | 41/328 |
| senza sez. 4 | `rgysygygggry` | [4] ✓ | 0 | 0/312 | 16/328 |
| senza sez. 5 | `rgygsgygggry` | [5] ✓ | 0 | 1/292 | 42/328 |
| senza sez. 6 | `rgygysygygrr` | [6] ✓ | 0 | 1/312 | 16/328 |
| senza sez. 7 | `rgygygsgggrr` | [7] ✓ | 0 | 0/292 | 44/328 |
| senza sez. 9 | `rgygygygsgrr` | [9] ✓ | 0 | 0/292 | 52/328 |
| senza 3 e 9 | `rysgygygsgry` | [3, 9] ✓ | 0 | 1/256 | 93/328 |
| senza 5 e 9 | `rgygsgygsgrr` | [5, 9] ✓ | 0 | 0/256 | 93/328 |
| **senza 4 e 5** (Chorus + Verse 3) | `rgygyssgygry` | **[6, 7]** (tolte: 4, 5) | 0 | **37/276** | 53/328 |
| senza 7 e 8 | `rgygyssgggry` | [6, 7] (tolte: 7, 8) | 0 | 2/276 | 57/328 |
| senza 4, ripeti 6 | `rgysygygygry` | [4] ✓ | 0 | 1/312 | 17/328 |
| **senza 5, ripeti 7** | `rgygysygggry` | **[6]** (tolta: 5) | 0 | **37/312** | 53/328 |
| **senza 3, ripeti 8** | `ryygygsgggry` | **[7]** (tolta: 3) | 0 (2 cori verdi sfasati su cori uguali) | **123/292** (42%) | 169/328 |

**Gravità di «non presente» alla strofa sbagliata** (strofe con gli stessi accordi): quando l'audio non distingue le strofe (due tolte vicine, o una tolta e una ripetuta), il motore segna «non presente» un'altra strofa e allinea la strofa del foglio sulla musica di una gemella. L'effetto per l'utente è che **si evidenzia il testo di una strofa mentre ne suona un'altra** (36 accordi, 57 s, il 13% del brano; fino al 42% nel caso peggiore con ripetizione) e che la strofa che davvero suona non ha evidenziazione («non presente nell'audio»). La sezione sbagliata è gialla («da controllare») e non verde; il rimedio è «Correggi a orecchio». Gravità: bassa (segnalato, non verde); ma la sezione «non presente» dovrebbe essere quella tolta.

Rispetto al round 9 tutti i 13 casi migliorano (da 16–169 eventi su altra musica a 0–123, 11 su 13 a 0–37); nessuna verde sbagliata sul testo (nel round 9 c'era la sezione 6 con 12/16 nel caso «senza sezione 5»). Il caso «senza sezione 5» del round 9 è risolto.

### C2. Tagli

| caso | riconosciuto | colori | saltate | verdi sbagliati (tempo) | eventi su altra musica | round 9 |
|---|---|---|---|---|---|---|
| 20% (102,7 s) | **no** | `rrrrrrrrrsrr` | [10] a torto | 0 | 277/312 | non riconosciuto, `rrrrrrrrrrrr` |
| 30% | sì | `rgygssssssss` | [5–12] ✓ | 0 | 0/98 | non riconosciuto |
| 45% (231,1 s: nel Chorus 6) | sì | `rgygygssssss` | [7–12] ✓ | **sez. 6: 11/11** | 4/151 | non riconosciuto |
| 70% | sì | `rgygygygyrss` | [11, 12] ✓ | 0 | 5/248 (sez. 10 metà presente) | uguale |
| −60 s | sì | `yssgygygggrr` | **[2, 3] a torto**, sez. 1 assente non saltata | sez. 4: 5/16 | 40/276 | `rrygygygggrr`, 52/328 |
| −60 s, taglio 20% | analisi rifiutata (`null`) | – | – | – | – | idem |
| −60 s, taglio 30% | no | `rrsrrrrrrrrr` | [3] a torto | 0 | 292/292 | non riconosciuto |
| −60 s, taglio 45% | sì | `ygygssssssss` | **[5, 6] a torto** (36+11 eventi) | **sez. 2 (testo), sez. 4 (tempo): 16/16 ciascuna** | 87/98 | non riconosciuto |
| −60 s, taglio 70% | sì | `ygygygysssss` | [8, 9] a torto | sez. 2, 4, 6: 16/16 ciascuna | 149/181 | `rrrgygyrrgry`, 152/308 |

- **20%:** non riconosciuto, tutte rosse e una saltata a torto. Il taglio al 20% (1:43 su 8:33) è un estratto di un minuto e 43 secondi: raro. L'utente deve usare «Usa comunque».
- **45% a metà ritornello:** la sezione 6 (Chorus, 220–239 s nell'intero) è tagliata a 231 s: l'engine la lascia **verde** con i suoi 12 accordi presenti 2,7–3,7 s **in anticipo** (differenza dalla posizione nell'intero: −2,74 −3,16 −3,34 −3,25 −3,72 −3,53 −3,48 −3,51 −3,50 −3,48 −3,51 −3,48 s) e gli ultimi 4 saltati. È un **verde sbagliato** (bug 6): in play il ritornello si evidenzia fino a 3,7 s prima. Il caso non c'era nella tabella dell'implementatore (30/40/50/60%): un taglio a metà sezione lo scopre.
- **−60 s:** il verse 1 ha solo 3 s residui; le sezioni 2 (Chorus) e 3 (Verse 2) sono segnate «non presente» mentre suonano, e la sezione 1 (gialla) evidenzia il testo del Verse 1 sulla musica del Verse 2 (35 eventi). Con un taglio in più compaiono **verdi sbagliati** (Chorus 2 verde su musica di altro; nei casi −60 s + 45 e + 70% sezioni verdi con 16/16 cambi oltre 250 ms dalla posizione vera): nel round 9 gli stessi file davano solo rosso/giallo, quindi **il round 10 introduce verdi sbagliati** in questi casi combinati (bug 5).

### C3. Assolo al posto di una sezione (reale)

20 s di un'altra parte del brano, trasposti (`asetrate` + `atempo`), al posto di una sezione:

| sezione sostituita | colori | «non presente» | eventi su altra musica |
|---|---|---|---|
| 4 (+3 semitoni) | `rgyrygygggry` | no (la sez. 4 è rossa, 2 gap) | 17/328 |
| 6 (−2) | `rgygyrygggry` | no (rossa) | 20/328 |
| 8 (+5) | `rgygygyyggry` | no (gialla) | 19/328 |
| 7 (0, un'altra parte) | `rgygygsgygrr` | **sì** [7], 3 gap | 2/292 |

L'assolo sul reale non diventa «salto + gap» in 3 casi su 4: la sezione resta rossa o gialla con i cambi evidenziati sulla musica estranea (16 eventi); non è mai verde. Sul sintetico l'implementatore ha 5 semi giusti; sul reale la sola sezione 7 va. Gravità bassa (segnalata).

### C4. Tempo libero

Il mio banco del round 9 (`round9-tester-engine.mjs free`, 4 banchi × 3 semi = 24 sezioni libere): **giallo 18 sezioni, 111 cambi, 85,6% entro 250 ms** (≥ 75 ✓), **mai verde** ✓, **rosso 6 sezioni, 42 cambi, 52,4%** (richiesto < 50 ✗; round 9: 54,0%), Spearman confidenza/errore −0,42 ✓. L'implementatore ha calibrato la soglia su un insieme più largo (132 sezioni, 47,5%) e lo dichiara: sul mio banco l'obiettivo non è raggiunto.

### C5. Il reale intero contro il round 9

`round10-tester-real-vs-r9.mjs`: 328 eventi, **328 entro 250 ms, differenza massima 0,000 s, 0 oltre 20 ms**; stessi BPM (`- 101 140 137 138 136 138 137 139 136 - -`); stesse confidenze; colori `rgygygygggrr` → `rgygygygggry` (sezione 12: da incerta a da controllare con confidenza 0,30; nuova soglia del tempo libero). Nessuna differenza da elencare.

## D. Testi e interfaccia

`round10-tester-texts.cjs` sul reale, a 320, 360, SE e 13:

| larghezza | righe (12) | altezza | elementi tagliati o fuori | overflow orizzontale | gap |
|---|---|---|---|---|---|
| 320 | 12 | 54–92 px | 0 | 0 | 48 px |
| 360 | 12 | 54–94 px | 0 | 0 | 32 px |
| SE (375) | 12 | 54–78 px | 0 | 0 | 32 px |
| 13 (390) | 12 | 54–78 px | 0 | 0 | 32 px |

- Parole intere ovunque («sicura», «da controllare», «incerta», «verificata ✓», «tempo libero») e una riga col motivo per le gialle e le rosse («tempo libero: i cambi sono stimati», «tempi poco netti»). Le sezioni gialle a 320 px hanno tre righe di stato (stato, BPM, motivo): niente è tagliato.
- Gap: «0:59–1:03: passaggio non scritto nel foglio (4 s)» e «nessuna azione richiesta»; in play: «Fuori dal foglio», «Riprende tra 4 s con «G»» (poi 3, 2, 1), tempo «♩–», niente «≈»; il foglio mostra la sezione che riprende (Chorus) con «POI G». Verificato sulla schermata (SE).
- «Correggi a orecchio» con 36 accordi: la barra fissa con «Anteprima» e «Salva» sempre visibile a 320 (y 508–560/568), 360 (680–732/740), SE (607–659/667), 13 (604–656/664); testo «Puoi fermarti quando vuoi: i tocchi fatti vengono salvati»; partenza da un accordo (toccando l'accordo): il riquadro tratteggiato lo mostra; salvataggio parziale provato (4 tocchi, B5). **A 320×568 il bottone «Cambio!» (y 450–609) sta quasi tutto sotto la barra (visibili circa 15 px)**: a quella larghezza chi corregge deve scorrere prima di poter toccare il bottone principale (bug 14); a 360, SE e 13 sta tutto sopra la barra.
- Sezione saltata: niente loop e l'avviso «Questa sezione non è nell'audio» (e2e dell'implementatore e `round10.cjs skip`: verdi nella regressione).

## E. Regressione, prestazioni, prova da utente

### E1. Regressione

- `npm test`: **250/250**, 0 `todo`, ~40 s (con i miei `todo` in `test/regression/`, che non fanno parte del glob di `npm test`: `node --test test/regression/` li mostra: 5 + 3 `todo`, 2 passano).
- `bash test/e2e/round10-regress.sh`: lo script completo con le parti solo-motore (`round7-tester-engine all` da solo supera i 25 minuti) l'ho interrotto dopo 11 script; i primi 11 (round 4, 5, 6 ×3, 7 panel, 7 flow ×3, 7 tester a, 7 tester core) sono verdi. Per le restanti ho lanciato un elenco ridotto (tutti i browser: round 5–9 e i miei):

  | gruppo | risultato |
  |---|---|
  | round 4, 5, 6 (real, audio, height, browser), 7 (panel, flow ×3, tester a, core, robust-app, app cancel/persist), round 5 browser e testi | tutti verdi |
  | `round7-tester-app synth` | 1 FAIL atteso già dal round 9 (C3c: evidenziazione dal vivo nel tempo libero, media 276 ms; C6b non eseguibile) |
  | `round8 all` 360 / SE / 13, `round8-tester-app sync` 320 / 360 | 1 FAIL ciascuno: «S1 righe compatte ≤ 64 px» (ora 54–94 px per scelta: righe a due righe di stato e motivo); gli altri controlli (testo non tagliato, pulsanti ≥ 44 px, «Fatto» in vista) verdi |
  | `round8-tester-c-app`, `-gap-app`, `-app correct/disabled/panel`, `-user SE` | verdi |
  | `round9` (cut, gap, noise, lock, texts, corr), `round9-tester-app` (10 modi), `round9-tester-decode`, `-user SE`, `round9-decode-check` | verdi (decodifica: reale intero 513,65 s, 328 eventi, app − Node mediana 0 ms) |
  | `round10.cjs all SE` | 97 PASS, 0 FAIL |

  Non rieseguiti per tempo (puro motore, già coperti dai miei banchi sintetici e dai 250 test): `round7-tester-engine`, `round8-long`, `round8-tester-a/b2/c/updated`, `round9-tester-engine cut|missing|intro` (ho rieseguito `free`), `round5/6-tester-core/fuzz`.

### E2. CPU ×4 (3 corse, `round9-perf.cjs SE 4 3`)

| | totale | decodifica | analisi | frame più lungo | RSS picco |
|---|---|---|---|---|---|
| round 10, corsa 1 | 13,0 s | 2,2 s | 10,5 s | 104 ms | +79 MB |
| round 10, corsa 2 | 13,1 s | 2,1 s | 10,7 s | 135 ms | +93 MB |
| round 10, corsa 3 | 14,0 s | 2,4 s | 11,4 s | 108 ms | +74 MB |
| round 9, stessa macchina, stesso momento | 12,4 / 13,6 / 12,9 s | 2,0 / 1,9 / 2,0 s | 10,2 / 11,5 / 10,7 s | 89 / 119 / 86 ms | +79 / +82 / +74 MB |
| round 9, mio report | 9,8 / 9,8 / 11,3 s | – | – | 86 / 77 / 88 ms | +84 / +78 / +88 MB |

La macchina oggi è più lenta che nel round 9 (il round 9 rifatto adesso dà 12,4–13,6 s). Contro il round 9 misurato adesso: totale **+3%** (media 13,4 contro 13,0 s), frame più lungo **+18%** (media 116 contro 98 ms: 104/135/108 contro 89/119/86, con una corsa a 135 ms). Contro i numeri del mio report (macchina più veloce) il totale sembra +24…+34%, ma non è confrontabile. Il totale rispetta il limite del 10%; il frame più lungo no (bassa, bug 17: nessun frame sopra 140 ms, «Annulla» 31–41 ms).

### E3. Prova da utente su SE e 13 con l'mp3 reale

Compiti: importa e sincronizza, ascolta i tic in una sezione stabile, trova un accordo che «arriva tardi» e ritoccalo, sposta una sezione intera, suona da metà. Su entrambi tutto completato (0 errori di pagina; analisi 3,9–5,0 s). Esitazioni, in ordine:

1. **Dopo la sincronizzazione nessun segno del ritocco**: nel foglio non c'è niente da toccare; il ⇄ promesso nel compito non compare (0 su 12 intestazioni) né dopo aver riaperto il brano. Chi non sa che esiste lo scopre solo toccando il testo di una riga nella schermata di sincronizzazione (senza icona) o con una pressione lunga su un accordo (senza avviso).
2. **Trovare l'accordo in ritardo** non è guidato: non c'è modo di vedere quali accordi sono incerti (l'app dà il colore di sezione, non di accordo). L'ho scelto a metà della prima sezione gialla.
3. **Pressione lunga su un accordo:** il foglio si apre (una sola scheda, tempo 2:00,7 nel suo titolo); se il dito è sulla zona dei pulsanti il rilascio preme il pulsante sotto (bug 4). Il foglio non spiega che «Questo e i seguenti» sposta anche gli accordi dopo (il nome è chiaro, la scelta predefinita è «Solo questo accordo»).
4. «Ascolta da qui»: parte 2 s prima e si ferma 2 s dopo come promesso.
5. **Spostare una sezione intera** dalla riga della schermata di sincronizzazione: ok, la riga diventa «verificata» e il conteggio sale (anche se è solo un ritocco): non si capisce che un ritocco vale «a orecchio».
6. **Suonare da metà:** toccare un accordo a play fermo apre la scheda del diagramma, non fa partire il brano; durante il play il tocco fa saltare all'accordo (da 2,0 a 254,1 s: ok). Per iniziare da metà bisogna prima premere Play: una piccola esitazione.
7. Con il gap in play tutto chiaro; il foglio scorre alla sezione che riprende.

## Bug

| # | gravità | descrizione |
|---|---|---|
| 1 | media | **Dopo un ritocco i tic non seguono il nuovo tempo.** `nudgeEvent` / `nudgeSection` non aggiornano `eventBeats`: l'accordo accorciato mantiene i suoi tic (fino a **2–4 tic in 0,1 s** dopo 20 tocchi di −0,25) e uno allungato li allarga (1,2 s con 4 tic = 0,3 s fra i tic). Il compito A5 («dopo un ritocco i tic seguono i nuovi tempi») non è soddisfatto; dopo «Correggi a orecchio» sì (`eventBeats` azzerati). `todo` (2 test) |
| 2 | media | **Ritocco accanto a un gap: il gap sparisce.** Su un accordo (o sezione) dopo un gap, −0,05 s (sul reale: gap 59,3–63,5 s, accordo 35) fa sì che `shiftEvents` scarti il gap (`g.endSec <= t[before]` non è più vero); l'accordo prima dura 5,5 s e in play a 1:01 il pannello mostra «G» invece di «Fuori dal foglio». Annulla recupera. `todo` (2 test) |
| 3 | media | **Il pulsante ⇄ nell'intestazione non compare** dopo la sincronizzazione né dopo aver riaperto il brano (0 su 12 intestazioni sul reale, 0 su 6 sul sintetico): `onClose` chiama `buildBody()` prima di `loadAudio()` e nessuno ricostruisce il foglio dopo. Compare solo dopo un'altra ricostruzione (per esempio il tasto «collassa le ripetizioni»). L'e2e dell'implementatore prova il ritocco solo dalla riga di sincronizzazione. `round10-tester-nudge.cjs conflict` (H1) fallisce |
| 4 | media | **Pressione lunga su un accordo (gesti).** (a) il rilascio del dito attiva il pulsante comparso sotto il dito (−0,25 s con un accordo a metà schermo: tempo cambiato di nascosto; «Ascolta da qui»; la scelta di scope), riproducibile su SE e 13 con tocchi veri; (b) un tremolio di 1–3 px annulla la pressione (`pointermove` senza soglia): con un dito vero il foglio potrebbe non aprirsi; (c) `.ch` è selezionabile (`user-select: auto`): su iPhone la pressione lunga può selezionare il testo. Non provato su iOS vero (a e b dipendono dal browser) |
| 5 | media | **Reale con i primi 60 s tolti:** Chorus 2 e Verse 2 segnati «non presente» mentre suonano, Verse 1 (tre secondi residui) gialla con il testo sulla musica di Verse 2 (35 eventi). In più **verdi sbagliati nei casi combinati** (−60 s + taglio 45% o 70%: Chorus 2/4/6 verdi con 16/16 cambi oltre 250 ms dalla posizione vera, il Chorus 2 con il testo di un'altra sezione), che nel round 9 davano solo rosso/giallo. `todo` (reale) |
| 6 | media | **Reale tagliato a metà di una sezione (45%): verde sbagliato.** Chorus 6 resta verde con 11/11 eventi presenti 2,7–3,7 s in anticipo; gli ultimi 4 sono saltati. Il caso 30/40/50/60% dell'implementatore non lo trova. `todo` (reale) |
| 7 | bassa | **Reale tagliato al 20%** (1:43): non riconosciuto, tutte rosse, una sezione saltata a torto (la 10); come nel round 9 (il 30% ora va). `todo` (reale) |
| 8 | bassa | **Sezioni uguali per gli accordi:** con due sezioni tolte vicine o una tolta e una ripetuta il motore segna «non presente» un'altra strofa; il testo di una strofa si evidenzia mentre suona un'altra (36 eventi, 13% del brano; fino a 123/292 con tolta + ripetuta). La sezione è gialla, mai verde; il rimedio è «Correggi a orecchio». Già dichiarato dall'implementatore |
| 9 | media | **Il numero dei tic non è il numero dei quarti della musica.** Nel reale le 4 strofe da 36 accordi hanno gli stessi battiti in 2 posizioni su 36 (ritornelli 9 su 16); 31% degli accordi stabili da 3, 5 o 7 quarti; il 17% degli intervalli fra i tic devia oltre ±15% (fino a 0,49–1,49 battiti). I tic ripartono da ogni inizio accordo invece di stare su una griglia: un clic che «balla». Precisione degli inizi (±250 ms = ±0,6 battiti) rende ±1 tic. Sul sintetico il conteggio nella finestra vera è giusto per 43 accordi su 44 perché lì gli inizi sono trovati a ±50 ms |
| 10 | bassa | **Ultimo accordo:** i tic arrivano fino alla fine dell'allineamento (sintetico: 11 invece di 8, la coda silenziosa conta; ultimo accordo ritoccato +5 s va oltre la fine dell'audio: 116 contro 111 s) |
| 11 | bassa | **Loop:** un intervallo di 896 ms (≈2 battiti) fra l'ultimo tic di un giro e il primo del successivo: un tic manca al riavvolgimento |
| 12 | cosmetico | Il pannello mostra «♩≈142,5» dove la schermata di sincronizzazione ha 141,4 BPM misurati (battiti/durata contro BPM misurato) |
| 13 | bassa | **Ritocco e ancore manuali:** il ritocco della sezione ancorata è assorbito (primo accordo −7 ms con +0,25 richiesti, altri 21 accordi stirati) senza avviso; il ritocco di un accordo sposta 242 ms invece di 250. `todo` |
| 14 | bassa | **«Correggi a orecchio» a 320×568:** il bottone «Cambio!» sta quasi tutto dietro la barra fissa (visibili circa 15 px su 159); a 360, SE e 13 va bene |
| 15 | bassa | **Scoperta senza istruzioni:** né il ritocco di un accordo (pressione lunga) né quello di una sezione dalla riga (tocco sul testo, nessuna icona, `title` invisibile sul telefono) hanno un avviso o un'etichetta; il ⇄ nell'intestazione manca (bug 3) |
| 16 | bassa | **Tempo libero:** rosso al 52,4% sul mio banco (richiesto < 50%); giallo 85,6% e mai verde sono ok. L'implementatore lo dichiara |
| 17 | bassa | **Prestazioni ×4:** frame più lungo +18% rispetto al round 9 misurato adesso (104/135/108 contro 89/119/86 ms); totale +3% (ok) |
| 18 | cosmetico | Testi: «perdi le **1 sezioni** verificate a orecchio» (singolare); un ritocco fa diventare la sezione «verificata a orecchio» (verde scuro, conteggio) anche se la correzione parziale lascia 8 accordi su 12 sul tempo ritoccato |

Non sono bug: conto alla rovescia del gap sempre arrotondato per eccesso; il pannello in modalità audio non ha il conto iniziale; il tic accentato è ogni 4 tic per sezione (non segue la battuta della musica, ma è coerente con la timeline); «Ascolta da qui» si ferma a +1,92 s invece di +2 s (setTimeout).

## Verdetto

**Round 10 accettabile con riserva, nessun bloccante.** Le correzioni dei bug del round 9 funzionano: sezioni tolte singole segnate giuste (6 su 6, 0 verdi sbagliati; quasi tutti i casi migliorano di 16–93 eventi su musica sbagliata a 0–2), tagli al 30–95% riconosciuti, il reale intero resta identico al round 9 (328/328, differenza 0,000 s), testi interi e senza tagli a 320, 360, SE e 13, barra fissa nella correzione, il gap in play corretto.

Le due richieste dell'utente funzionano **nel caso normale** ma hanno difetti che l'utente incontra: (A) il conteggio dei tic è esattamente quello della timeline, il clic è silenzioso nel gap, accentato ogni 4, coerente con contatore, punti e badge; ma **il numero di tic per accordo non è affidabile come "quarti veri"** (bug 9: ±1 in circa metà degli accordi del reale e un clic irregolare perché ripartito ad ogni accordo) e non segue un ritocco (bug 1); (B) il ritocco rapido funziona in tutti i suoi passi (tempi, scope, Annulla, Ascolta, reload, limiti 0,1 s, conflitti con «Sposta tutto» e «Correggi a orecchio»), ma **il pulsante ⇄ dell'intestazione non esiste dopo la sincronizzazione** (bug 3), **il rilascio del dito può premere un pulsante nascosto** (bug 4) e **cancella il gap** se tocca la riga dopo (bug 2).

In rosso non c'è niente che rompa un salvataggio o corrompa i tempi (ordine, 0,1 s, JSON, undo: tutto esatto). Resta da correggere il verde sbagliato del taglio a metà sezione (bug 6) e quello dei casi con i primi 60 s tolti (bug 5): sono le due eccezioni al principio «nessun verde sbagliato».

## Non verificato

- iOS reale: la pressione lunga (rilascio, tremolio, selezione del testo), l'audio con `AudioContext` e il suo orologio; tutto con Chromium e tocchi iniettati via CDP.
- Che i tic cadano sui battiti veri della musica reale (nessuna verità sul reale: il rapporto sugli attacchi è ≈ 1, non distingue; il solo confronto serio sul reale è la coerenza fra sezioni sorelle). Non ho ascoltato.
- Ritocco accanto a una sezione saltata in browser (solo test unitari dell'implementatore), ritocco con il metronomo senza audio.
- Rete lenta, rumore musicale, file senza intestazione Xing/LAME (come nei round precedenti).
