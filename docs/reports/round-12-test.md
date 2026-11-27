# Round 12 — Report del tester

Verifica indipendente del round 12: seek esatto (A), confine fra accordi uguali / primo G del Chorus 1 (B), regolazione e informazioni tecniche (C), bug del round 11, regressione e prova da utente su un profilo Android (D). Nessun testo del brano reale è riportato: solo conteggi, tempi, nomi di sezione e di accordi. Gli screenshot (mostrano il testo) sono in `test-artifacts/round-12/` e non sono versionati; l'audio derivato è in `test-artifacts/` (ignorato da git).

Il reale è `test/fixtures/local/american-pie.{mht,mp3}`: 513,6 s, 12 sezioni, 328 accordi. Tutto è **Chromium** (Playwright, profilo Pixel 7, tocchi veri): non ho Firefox né un telefono. Il «round 11» di confronto è `ca01341^` (codice del round 11) in un worktree temporaneo con `dist` costruito a parte, poi rimosso.

**Metodo indipendente (A).** Non mi fido di nessun orologio dell'app. `round12-tester-seek.cjs` fa passare il suono *dell'elemento audio* (ma non i clic: sono oscillatori) in un `ScriptProcessor` agganciato alla sua `MediaElementSource` (creata dall'app quando il metronomo è acceso), e registra: il suono catturato, ogni cambio dell'evidenziazione (`MutationObserver` su foglio e pannello), l'avvio di ogni oscillatore del clic e la posizione che il lettore dichiara ogni 50 ms. `round12-tester-seek-analyse.py` (solo numpy) trova la **posizione vera di ogni finestra di 1,5 s** del suono catturato correlandola con la decodifica ffmpeg dell'mp3 (correlazione 0,99–1,00 sulle finestre buone, accetto ≥ 0,7); per l'80% (suono allungato dal browser) uso l'inviluppo con passo di 5 ms, dopo aver escluso le finestre fuori linea. Gli attacchi veri sono quelli del mio metodo del round 11 (`round11-tester-indep.py`: STFT, flusso a mezze onde in tre bande): per ogni accordo, il massimo entro ±0,12 s dal suo inizio con forza ≥ 3 (264 accordi). Limite: il percorso di cattura ha un ritardo proprio di circa 100 ms (`playbackTime` del `ScriptProcessor` è a scatti ±15 ms), che misuro **con un Play da 0 senza salto, della stessa versione e alla stessa velocità** (96–100 ms a 1×, 48 ms a 0,8×) e sottraggo: gli *scarti fra tipi di salto* sono precisi a pochi ms, gli *assoluti* a ±20 ms.

| file (tutti in `test/e2e/`) | contenuto |
|---|---|
| `round12-tester-seek.cjs`, `-seek-analyse.py`, `-seek-summary.py` | A1/A2: tutti i salti sul reale, cattura del suono, posizione vera, scarto evidenziazione → attacco, clic, silenzi. Argomenti: `new\|old`, modi `base,section,chord,listen,pause,rate,scrub,loop,mem`; con `R12_SONG`/`R12_MP3`/`R12_POS`/`R12_OUT` anche su un brano sintetico e altri formati (A3) |
| `round12-tester-edge.cjs`, `round12-tester-end.cjs` | A2: fine del file, dieci salti in un secondo, due salti a 20 ms, pausa subito dopo un salto, 30/120 salti (RSS e URL revocati); `end` = cosa fa l'elemento dopo la fine del brano (bug 1) |
| `round12-tester-event35.mjs`, `-pairs.py` | B: 27 varianti di decodifica del reale (le mie), tutte le coppie di accordi uguali del reale contro i miei attacchi, sintetico mio con un accordo tenuto 5 s che si spegne e riattacca (sintesi propria, non il generatore del round 7: lì ogni accordo è battuto a ogni quarto e non «tiene») |
| `round12-tester-offset.cjs` | C: regolazione ±50 ms da −1000 a +1000, effetto immediato, tic e puntini, salvataggio, «Ascolta e regola», «Informazioni tecniche» (parole del foglio cercate una per una nel JSON) |
| `round12-tester-user.cjs` | D: prova da utente su Pixel 7 (importa, sincronizza, suona dal Verse 1 al Chorus 1, salta a metà, +100 ms, esporta la diagnostica) |
| `test/regression/round12-tester-samechord.test.js`, `round12-tester-end.test.js` | 2 test `todo` per i bug 1 e 2; non fanno parte del glob di `npm test` (`node --test "test/regression/*.test.js"`) |

## Esito

| Punto | Esito |
|---|---|
| A1 seek esatto, 7 modi di salto × 5 posizioni (30, 63, 150, 300, 450 s) | **confermato.** Scarto fra posizione dichiarata e suono vero: mediana per prova 0–7 ms, peggiore prova 18 ms (barra, a 30 s), peggiore singola lettura 52 ms (346 ms nella barra, solo nei primi 250 ms dopo il tocco su Play, prima che il suono parta). Prima (round 11, stesso metodo): mediana 640–845 ms, fino a **+1697 ms**. Evidenziazione → mio attacco: mediana +14…+27 ms (come un Play da 0: +27), p90 46–86 ms, max 155 ms |
| A2 clic, silenzi, memoria | **0 clic doppi e 0 mancanti** dopo i salti (380 clic su 380 battiti in 27 prove; 268 su 268 in una seconda serie a macchina libera); silenzio digitale al salto 48–100 ms (prima 29–42), al giro del loop 70–96 ms; **bug 1: a fine brano l'audio riparte da capo mentre il pannello dice «fermo»**; memoria dopo 30 salti **+118 MB** di RSS contro +12 (bug 3), URL tutti revocati (31/31, 121/121) |
| A3 altri formati (m4a, ogg, wav) | seek normale ancora esatto: m4a ±6 ms, wav ±1 ms, ogg −24 ms costante (+46 ms in un caso); la sincronizzazione funziona con tutti |
| A4 perché non l'avevo visto | vedi A4: i miei test confrontavano l'app con se stessa (orologio dichiarato) e le lunghe prove partivano da 0, dove il seek è esatto; l'errore sta nei salti, vale ±0,3…1,7 s |
| B primo G del Chorus 1 (evento 35) | **non riesco a riprodurre lo scivolamento** né con il motore del round 12 né con quello del round 11: in 27 varianti mie l'evento 35 sta fra 63,39 e 63,55 s e dura 0,77–0,80 s; nell'app (Chromium) 63,43 s, 0,79 s. Le 6 coppie di accordi uguali del reale stanno tutte su un attacco chiaro (anche prima). Nel sintetico mio il primo confine (G tenuto di una strofa → G del ritornello) è giusto (±40 ms), il secondo (G tenuto → stesso G battuto a ogni quarto) è **in ritardo di un quarto (+0,63…0,66 s) in 21 casi su 21, con la regola accesa o spenta** (bug 2) |
| C regolazione e diagnostica | regolazione **a posto** (9/9): passi da 50 ms, −1000…+1000, evidenziazione e puntini si spostano subito (±300 ms ⇒ ±300 ms a ±10), salvata per dispositivo e non nel brano, «Ascolta e regola» 5 s; **i clic del metronomo non si spostano** con la regolazione (bug 5). Diagnostica: tutti i campi chiesti, 0 parole del foglio su 259, deriva misurata (pendenza 0,9999–1,0002, scarti ≤ 6 ms); non include gli ultimi ≤ 10 s (bug 4) |
| D bug del round 11 | **1, 2, 3, 4, 5, 7, 10 risolti** (tabella in D); `npm test`: **291 pass, 0 fail**; `round10-regress.sh`: parziale (11/59, tutti verdi) |
| D prova da utente (Pixel 7) | importa, sincronizza (4 s), suona dal Verse 1: evento 34 a 57,94 s, evento 35 a 63,46 s per 0,78 s, nessun «Fuori dal foglio»; salto, +100 ms, «Ascolta e regola» e diagnostica senza blocchi (10/10) |

## A. Seek esatto

### A1. Scarto contro il suono vero, per tipo di salto e posizione (`round12-tester-seek.cjs new`, 2 serie, e `old`)

I «salti» sono quelli che l'utente ha: **Play dalla sezione** (pressione lunga sull'intestazione, dopo aver aperto i gruppi ripetuti), **tocco su un accordo durante il play**, **«Ascolta da qui»** (foglio di ritocco), **pausa e ripresa** (la ripresa dopo un salto), **velocità 80%**, **barra** (`#sync-scrub` della schermata di sincronizzazione, con il clic), **loop** (3 giri di due sezioni da 19 s). Capture di 11–13 s dopo il salto (9 s la barra, 61 s il loop).

Scarto **posizione dichiarata − posizione vera**, mediana per prova, ms, **dopo** il round 12 (colonne = posizioni richieste; per «sezione» le intestazioni più vicine: 0,3 / 63,4 / 144,8 / 297,9 / 458,9 s; per gli altri i tempi veri dell'accordo, ±1 s; macchina libera):

| tipo | 30 | 63 | 150 | 300 | 450 |
|---|---|---|---|---|---|
| sezione | −1 | 0 | +4 | 0 | +1 |
| accordo | +2 | +2 | +3 | +1 | +2 |
| ascolta da qui | +2 | +1 | +4 | +7 | +2 |
| pausa e ripresa | +2 | +2 | 0 | +3 | −1 |
| 80% | +6 | +2 | +7 | +4 | −3 |
| barra | −18 | +9 | −4 | +2 | +4 |
| loop (2 sezioni × 3 giri; 144,8 e 297,9 s) | +4 (144,8 s) | | | +1 (297,9 s) | |

**Prima** (round 11, stesso metodo e stessa macchina):

| tipo | 30 | 63 | 150 | 300 | 450 |
|---|---|---|---|---|---|
| sezione | +27 (a 0,3 s il seek è esatto) | −640 | +1366 | +450 | +881 |
| accordo | −331 | −640 | +1367 | +451 | +1096 |
| ascolta da qui | +843 | +634 | +1366 | +449 | +1095 |
| pausa e ripresa | −332 | −638 | +1367 | +449 | +1095 |
| 80% | −332 | −638 | +1370 | +448 | +1101 |
| barra | +845 | −640 | +644 | +1697 | +1094 |
| loop | mediana +908 ms (+1366 e +451) | | | | |

Lo scarto prima dipende dal punto (a gradini di ~5 s: sono le 256 voci a un byte della tabella Xing, 27 KB ≈ 1,7 s l'una), **sempre fra −0,64 e +1,70 s**: l'affermazione dell'implementatore (+850, −642, +652, +1696, +1093 ms a 30/63/150/300/450 s) coincide con la mia barra (+845, −640, +644, +1697, +1094) entro 8 ms con un metodo diverso (cattura propria, correlazione per finestre, mio orologio). **Confermata.**

**Evidenziazione contro il mio attacco**, mediana / massimo in ms, dopo la correzione del ritardo di cattura (positivo = acceso dopo l'attacco). Numero di cambi: 13–47 per tipo. Dopo il round 12:

| tipo | 30 | 63 | 150 | 300 | 450 |
|---|---|---|---|---|---|
| sezione | +13 / 46 | +11 / 148 | +16 / 45 | +18 / 37 | +6 / 155 |
| accordo | +26 / 72 | +6 / 130 | +32 / 61 | +12 / 45 | +98 / 144 |
| ascolta da qui | +77 / 77 | +4 / 10 | +16 / 31 | +24 / 24 | +27 / 138 |
| pausa e ripresa | +23 / 63 | +26 / 99 | +38 / 50 | +7 / 27 | +23 / 139 |
| 80% | +7 / 78 | +26 / 134 | +28 / 50 | +11 / 36 | +16 / 52 |

Un Play da 0 (nessun salto) dà **+27 ms** di mediana, p90 59, max 82: è il valore «di base» dell'app (evento −25 ms del round 11 e latenza dell'uscita). Per tipo: sezione +16, accordo +27, ascolta +24, pausa +27, 80% +14, loop +17 (mediane con segno), p90 46–86 ms. I massimi di 130–155 ms sono sempre gli stessi accordi (intorno a 63 s e a 451–459 s) in ogni tipo di salto: sono l'errore del motore su quegli eventi (round 11: max 0,28 s), non dei salti. Prima: mediana −442…−768 ms, p90 ~1350 ms.

Dopo un salto, il primo cambio (quello causato dal salto) non è contato; i cambi seguenti nei 10 s sì.

### A2. Clic doppi o mancanti, silenzio, ricarica, memoria (`round12-tester-seek.cjs`, `round12-tester-edge.cjs`)

- **Clic**: gli avvii degli oscillatori contro i battiti della timeline, nella posizione dichiarata dal lettore dopo l'ultimo salto: **380 clic su 380 battiti, 0 doppi, 0 mancanti** in 27 prove (e 268/268 in 17 prove a macchina libera); con il round 11 556/555, 1 doppio (prima però i clic stavano sulla posizione *dichiarata*, cioè fino a 1,4 s fuori dal suono: il «clic fuori tempo» dei salti). Contro il suono vero (mappa mia): scarto clic − battito mediana −12…+6 ms, max 28 ms. (Il mio primo calcolo dava 1–2 battiti «mancanti» in 6 prove: sono finestre di correlazione scartate nella mia analisi, i clic grezzi ci sono tutti.)
- **Silenzio**: silenzio digitale nell'uscita del salto durante il play 48–100 ms (round 11: 29–42 ms); al giro del loop 70–96 ms (limite 150), nei 2 loop × 3 giri; il giro tiene la sezione (nessun errore di posizione). Il lettore dichiara `maxGapMs` 84 ms dopo 30 salti, `maxSeekMs` 5–10 ms (creazione della fetta).
- **Ricarica del blob**: dal tocco su «Ascolta da qui» al primo suono **163–193 ms** con l'mp3 esatto, **99–113 ms** con m4a/ogg/wav (seek normale): +65 ms circa per salto.
- **Fine del file**: **bug 1** (sotto). Dieci salti in un secondo: vince l'ultimo e suona (media a +2,4 s dal bersaglio); due salti a 20 ms: vince il secondo; pausa subito dopo un salto: ferma e posizione immobile; ripresa dallo stesso punto: PASS.
- **Memoria** (nessun altro Chromium acceso): 30 salti: RSS di tutti i processi **615 → 795 → 733 MB** (13 s dopo) contro 618 → 630 → 616 con il round 11; 120 salti: 813, 829, 848, 850 MB ogni 30 salti, 793 MB dopo 30 s (+157 MB dall'inizio): **assestamento, non perdita** (+0,4 MB per salto dopo i primi 30), JS heap 4,7 MB costante, URL creati = revocati (31/31 e 121/121; nella pagina ne restano 2: file intero e fetta corrente). Sul telefono +120–180 MB di memoria di lavoro sono il costo del blob da 7 MB ricaricato a ogni salto.

### A3. File che non sono mp3 (brano sintetico di 111 s del round 10 ricodificato con ffmpeg: m4a/aac 128k, ogg/vorbis q4, wav; mp3 di controllo; salti a 15, 45, 85 s: accordo e «Ascolta da qui»; riferimento = decodifica ffmpeg del file stesso)

| formato | Play da 0 | accordo (15/45/85 s) | «ascolta da qui» (15/45/85 s) |
|---|---|---|---|
| mp3 (esatto) | 0 | 0 / −2 / +3 | 0 / 0 / +3 |
| m4a | 0 | −3 / 0 / +6 | 0 / +3 / 0 |
| wav | 0 | 0 / 0 / −1 | 0 / 0 / 0 |
| ogg | 0 | −24 / −24 / −24 | +46 / −24 / −24 |

(ms, posizione dichiarata − vera, meno il Play da 0 dello stesso file.) Il seek normale funziona in tutti; l'ogg atterra 24 ms prima di quello che dichiara (granulo di Vorbis): non udibile, e l'evidenziazione è 24 ms in anticipo.

### A4. «Il seek con `el.currentTime` sbagliava di 0,6–1,7 s anche in Chromium: perché i tuoi test dei round 9–11 non l'avevano visto?»

1. **Confrontavo l'app con se stessa.** Tic, panel e «cambi veri» erano sempre letti con `el.currentTime` (le coppie `ctx` ↔ `currentTime` di `round10/11-tester-clicks`, il pannello campionato di `verse1`): la timeline e il clock dichiarato stanno nello stesso riferimento, quindi un seek che atterra altrove sposta *insieme* il suono e la posizione dichiarata e l'accordo sembra a tempo. Gli attacchi veri (mio STFT) sono nel riferimento del file; per confrontarli con il suono avrei dovuto catturare l'uscita e correlarla con la decodifica, cosa che ho fatto solo ora. I miei e2e di salto asseriscono il dichiarato con tolleranze larghe (`round11-tester-real.cjs` U1: `currentTime` entro 3 s dall'accordo toccato).
2. **Le prove lunghe partivano da 0.** `round10-tester-clicks` parte da 0 e `round11-tester-clicks` da un solo seek a 100 s (1084 tic): a 0 il seek è esatto (con il round 11 il «salto» a 0,3 s mi dà +27 ms), e a 100 s la tabella a gradini dà (misura mia ora: −0,27 s) uno scarto che non vedevo perché confrontavo dichiarato contro dichiarato.
3. **Ho dato per «piatto» ciò che non lo è.** Nel round 11 ho scritto che in Chromium `currentTime` è «esatto»; l'errore non è una costante ma una funzione a gradini della posizione (−0,64…+1,70 s), invisibile a un test che salta in un punto o due.
Conclusione: non era una svista del confronto ma un buco di metodo; questa misura (suono catturato + correlazione) lo chiude per Chromium. Non dice nulla di Firefox/Android (vedi «Non verificato»).

## B. Primo G del Chorus 1 e confine fra accordi uguali (`round12-tester-event35.mjs`, `round12-tester-pairs.py`)

Le mie varianti (diverse da quelle dell'implementatore: altre frequenze, altro decoder, un solo canale, ricodifiche, ritardo di avvio, banda del telefono, compressore, livello, tempo, tagli e inserzioni), reale, mono, motore del round 12; `ev35` e durata (in 0,001 s); in **tutte** `63,0 ≤ ev35 ≤ 63,6` e durata `< 1,5 s`:

| variante | ev35 | durata |
|---|---|---|
| 8000 / 16000 / 32000 / 48000 Hz | 63,434 / 63,434 / 63,433 / 63,433 | 0,79 |
| soxr precisione 28 a 22050; decoder mp3 a virgola fissa | 63,434; 63,434 | 0,79 |
| solo canale destro; miscela 0,7 L + 0,3 R | 63,435; 63,433 | 0,79 |
| ricodifica CBR 96k; mono 48k; vorbis q2; aac 96k | 63,434; 63,434; 63,434; 63,433 | 0,79 |
| decoder che tiene il ritardo (+26 ms); frame + ritardo (+51 ms); toglie 52 ms | 63,458; 63,505; 63,389 | 0,79 / 0,77 / 0,79 |
| 1 s di silenzio davanti | 63,434 | 0,79 |
| banda 150 Hz–5 kHz; passa-basso 1200 Hz | 63,434; 63,441 | 0,79 / 0,78 |
| compressore forte; livello −26 dB; +12 dB tagliato | 63,435; 63,434; 63,440 | 0,79 / 0,79 / 0,78 |
| orologio +1% / −1% (`atempo`) | 63,436; 63,427 (dopo aver riportato il tempo) | 0,80 |
| un frame (26 ms) mancante a 30 s / a 58 s; 120 ms di silenzio a 45 s | 63,409 / 63,409 / 63,551 | 0,79 |

- **Il motore del round 11, stesse varianti (5 provate)**: 63,434 / 63,434 / 63,505 / 63,435 / 63,440, durata 0,77–0,79: **anch'esso non scivola**. La correzione del round 12 sul reale non ha nulla da correggere nelle mie varianti: non posso né confermare né smentire che sul telefono funzioni.
- **Nell'app (Chromium, decodifica a pezzi)**: evento 34 a 57,89 s, evento 35 a 63,43 s per 0,79 s; evidenziato sul pannello a 57,94 e 63,46 s (prova da utente D, 60 ms), nessun «Fuori dal foglio».
- **Le 6 coppie di accordi uguali del reale** (eventi 35, 87, 139, 191, 243, 295; tutte e 6 fra due sezioni: il primo accordo di una sezione uguale all'ultimo della precedente): tutte con il confine su un attacco chiaro del mio flusso (forza ≥ 3 entro 120 ms), 0 «coda con riattacco forte altrove», **sia con il round 11 sia con il round 12**; unica differenza l'evento 295: 459,08 → 458,92 s (il nuovo è sull'attacco forte a 458,87, come dice l'implementatore).
- **Sintetico mio** (2 strofe/ritornelli × 3, 96 BPM, G tenuto 5 s battuto una volta e lasciato spegnere, ritornello che riattacca; 7 casi: decadimento 0,7/1,1/1,4/2,0 s, smorzato a 2,5–3,5 s, rumore 0,004 e 0,02): primo confine (G tenuto → G del ritornello) giusto, +1…+39 ms in 21 casi su 21; **secondo (G tenuto → stesso G battuto a ogni quarto) in ritardo di +0,63…+0,66 s in 21 casi su 21**, uguale con `sameChord: false` e nel motore del round 11. Il confine sta sul secondo colpo (un quarto dopo il riattacco vero, dove il suono era già a 0,19 contro 0,003 prima) e la regola lo lascia perché «già su un attacco chiaro» (`KEEP_TOL`, solo forza ≥ 3, senza chiedere che quell'attacco *segua un calo*). È lo stesso difetto che l'utente ha descritto (confine che non sta sul riattacco) in un'altra forma. Nel reale i casi così non ci sono (le 6 coppie sono tutte giuste), ma il test `todo` lo registra.

## C. Regolazione e diagnostica (`round12-tester-offset.cjs`, Pixel 7, reale)

- Passi: 3 «Prima» −50, −100, −150 ms («in anticipo di 50/100/150 ms»), 5 «Più tardi» fino a +100 («a tempo (0 ms)» a 0, «in ritardo di 100 ms»); intervallo −1000…+1000 e si ferma; ogni tocco esattamente ±50.
- **Subito**: a lettore in play cambio il valore e dopo 150 ms «tempo mostrato = tempo del file − latenza» a ±5 ms (0 / +300 / −300 → 3 / 303 / −296 ms). Evidenziazione: a +300 ms il cambio d'accordo arriva a posizione del file +300 ms (302, 303, 302, 301, 302), a −300 ms a −300 (−292…−309), tornando a 0 a 0 (±10). Contatore dei battiti/puntini del pannello: +307 ms / −293 ms. **I clic del metronomo non si spostano** (offset del clic dal battito 0 / 0 / 0 ms con +300 e −300): restano sul clock dell'audio (bug 5).
- Salvata in `gapp.device.v1.latencyMs` e **non nel brano**; sopravvive al ricaricamento («in anticipo di 150 ms», il lettore usa −150).
- «Ascolta e regola»: 5 s da mezzo secondo prima del punto corrente (201,3 → 201,7 playing → 205,7 paused dopo 6,1 s).
- **«Informazioni tecniche»** (libreria → Audio e cuffie; dopo 36 s di ascolto): `userAgent`, `platform`, `audioContext` (44100 Hz, `baseLatency` 0,01, `outputLatency` 0,032), latenza impostata, mp3 (`vbr` sì, `tag` sì, 21404 frame, 513,65 s), durata del browser 517,01 s contro scansione 513,65 s (il browser sbaglia di 3,4 s: segno che il seek proporzionale sul VBR sbaglia), metodo di decodifica a pezzi (11 pezzi, scarto massimo 0,1 ms), i tempi dei primi 60 eventi, salti (3, `maxSeekMs` 5, `maxGapMs` 0), **deriva misurata** (4 righe, pendenza 0,99987–1,00019, scarti −4…+6 ms, contro `AudioContext` ≤ 2 ms). **Nessuna delle 259 parole del foglio** (testi, nomi di sezione, accordi, titolo, artista) compare nel JSON come parola intera (un controllo sulle sottostringhe ne trova 6, tutte pezzi di nomi di campo come `firstEventTimesSec`), né titolo, né artista, né nome del file.

## D. Bug del round 11 e regressione

| bug del round 11 | stato | come l'ho verificato (mio, indipendente) |
|---|---|---|
| 1 evento 306 | **risolto** | nell'app evento 306 = 473,80 s (il mio attacco: 473,80), evento 32 = 53,05 s (attacco 52,96), evento 295 = 458,92 (attacco forte 458,87); gli altri 325 non rimisurati (l'implementatore dichiara che solo 295 e 306 si spostano) |
| 2 tic nel tempo libero | **risolto** | Verse 1 (35 accordi liberi), 7 cambi nei 12 s dopo il Play: 7 clic, tutti accentati (1000 Hz), a 1–6 ms dall'inizio dell'accordo, nessun clic intermedio; il pannello scrive «tempo libero: un tic a ogni cambio» |
| 3 guardia del rilascio 320 ms | **risolto** | `round11-tester-nudge jitter` (SE, 13, 320): rilascio a 250/330/400/700 ms dall'apertura sopra un pulsante: 0 accordi spostati; tremito 5/8/10 px apre, 13/20 px no; `round11.cjs press` PASS |
| 4 tap veloci rifiutati | **risolto** | tap a 150/300/450 ms sul pulsante del foglio aperto da ⇄: 12 accordi spostati (R1); tap deliberato a 150 e 400 ms dopo il rilascio accettato (J7); `round10-tester-nudge` X1, X2, X5, Y0, Y1 PASS (SE, 13) |
| 5 ritocco di una sezione ancorata | **risolto** | ancora 40,60 → 40,85 con +0,25: 12 accordi, tutti di +250 ms (min 250, max 250), gli altri fermi; −0,25 riporta a 40,60 (`round11-tester-nudge anchor`); X5 del mio `round10-tester-nudge`: PASS |
| 7 pulsanti del ritocco a 320 px | **risolto** | −0,25 / −0,05 / +0,05 / +0,25 s su una riga (`test-artifacts/round-11/nudge-320-secsheet.png` rigenerato) |
| 10 «Correggi a orecchio» con 35 accordi | **risolto** | `round9.cjs corr` PASS a SE, 13, 320 (9 controlli ciascuno); a 320 «Cambio!» intero sopra la barra, chip e istruzioni visibili (`test-artifacts/round-9/corr-320.png`) |

- `npm test`: **291 pass, 0 fail, 0 todo** (erano 274).
- `node --test "test/regression/*.test.js"`: 2 `todo` (i miei, sotto).
- `round10-regress.sh` (59 script): **non completato**: l'ho interrotto dopo 11 script su 59 (round4, 5, 6 ×3, 7-panel, 7 flow ×3, 7-tester-a, 7-tester-core) perché troppo lento: tutti exit 0, 0 FAIL. Le altre serie sono coperte dai controlli mirati di D (round9 corr, round11, round11-tester-nudge, round10-tester-nudge, round12-tester-*); i FAIL «vecchi» dell'implementatore (round8 S1, sync 320/360, round7-tester-app synth C3c) non rimisurati
- Il mio `round10-tester-nudge.cjs`: SE 44 PASS, 1 FAIL (G3, «tremolio di 6 px prima di 500 ms: nessun foglio», voluto dal round 11: la soglia è ora 12 px); 13: 1 FAIL identico (G3); a 320 lo script si ferma al primo gesto (la pressione lunga non apre, `TimeoutError` su `#nudge-close`) **come nel round 11** (stesso log): non è nuovo e `round11-tester-nudge 320 all` passa (33 PASS).
- `round11.cjs all` (SE, 13, 320): 11 PASS ciascuno; `round11-tester-nudge.cjs all` (SE, 13, 320): 33 PASS ciascuno; `round9.cjs corr`: 9 PASS ciascuno.

### D1. Prova da utente (`round12-tester-user.cjs`, Pixel 7 412×839, tocchi veri)

Importa il reale, sincronizza (3,9 s; «6 sicure · 4 da controllare · 2 incerte»; 328 eventi, nessun gap), **Play dall'inizio** e campiono pannello e posizione ogni 60 ms: evento 31 a 50,56 s, 32 a 53,08, 33 a 55,24, **34 (G) a 57,94, 35 (G del Chorus 1) a 63,46 s, 36 a 64,24 (0,78 s), 37 a 65,44, 38 a 66,82**: quello che il mio metodo vede come attacchi (57,9 e 63,4). Nessun «Fuori dal foglio» da 55 a 67 s. Salto a metà (tocco su un accordo a ~253 s durante il play): suona dal punto dopo 1,3 s, evento giusto (±1). «+100 ms» dal menu ⋯ (due «Più tardi»): «in ritardo di 100 ms», salvato 100; il menu entra a 412 px senza scorrimento orizzontale; «Ascolta e regola» si ferma da solo. Informazioni tecniche esportate (latenza 100, 60 eventi, `exactSeek` vero). 10/10 controlli, nessun errore di pagina.

## Bug

| # | gravità | descrizione |
|---|---|---|
| 1 | **alta** (regressione del round 12) | **A fine brano l'audio riparte da capo mentre il lettore dice «fermo».** Nel gestore di `ended` (`audio.js`), `seekMedia(0)` gira mentre lo stato è ancora `'playing'`, quindi `wasPlaying` è vero e chiama `el.play()` sulla fetta nuova: l'elemento ricomincia a suonare dall'inizio (`el.paused` falso, posizione 0,25 → 3,26 → 6,26 → 9,26 s), il pannello torna a «Play», tempo 0, nessuna evidenziazione, e un secondo tocco su Play sovrappone. Round 11: si fermava (`paused` vero). Riproduzione: brano reale, Pixel 7, `playFromTime(durata − 4)` e attendere 12 s (`round12-tester-end.cjs`); lo vede chiunque lasci finire il brano. `todo` in `test/regression/round12-tester-end.test.js` (riproduce con un finto `Audio` e un mp3 sintetico). Correzione probabile: nel gestore di `ended` fermare l'elemento (o impostare lo stato prima di `seekMedia`, o un parametro «senza play») |
| 2 | media | **Confine fra accordi uguali: in ritardo di un quarto (+0,63…0,66 s) quando l'accordo tenuto è seguito dallo stesso accordo battuto a ogni quarto** (21 casi su 21 del mio sintetico), con la regola di `samechord.js` accesa o spenta e nel motore del round 11. La regola non interviene perché `KEEP` accetta come «già su un attacco chiaro» il secondo colpo (solo forza ≥ 3, non chiede che l'attacco segua un calo di energia). Nel reale non c'è un caso così (6 coppie su 6 giuste), ma è la forma del difetto segnalato dall'utente. `todo` in `test/regression/round12-tester-samechord.test.js` |
| 3 | bassa | **Memoria**: ogni salto ricarica 7 MB in un blob; dopo 30 salti RSS +118 MB (795 contro 630 del round 11), 120 salti +157 MB dopo l'assestamento: non è una perdita (URL tutti revocati, JS heap piatto) ma su un telefono con poca RAM pesa; la copia in memoria del file (7 MB) resta per tutto l'ascolto |
| 4 | bassa | **«Informazioni tecniche» non comprende gli ultimi ≤ 10 s**: il lettore salva ogni 10 s e non salva uscendo dal brano. Dopo la prova da utente (play 70 s, salto, regolazione, «Ascolta e regola», uscita in ~12 s) il JSON dice `seeks 0`, `maxGapMs 0`; i salti e i silenzi dell'ultimo tratto non ci sono. Basta ascoltare almeno 30 s e aspettare 10 s dopo l'ultima azione, oppure salvare alla distruzione |
| 5 | bassa (da decidere) | **I clic del metronomo non seguono la regolazione «Evidenziazione»**: restano sul clock dell'audio (0 / 0 / 0 ms con 0, +300, −300). Se sul telefono il suono del file arriva in ritardo *rispetto ai clic* (percorso `<audio>` diverso da quello degli oscillatori, possibile su Firefox/Android) la regolazione sposta l'evidenziazione e i puntini ma non il clic: chi regola a orecchio con il clic acceso sentirà il clic fisso e l'accordo che si sposta |
| 6 | cosmetico | Ogni salto in play ora ha 48–100 ms di silenzio nell'uscita (prima 29–42) e 163–193 ms dal tocco al suono su «Ascolta da qui» (99–113 ms con gli altri formati); al giro del loop 70–96 ms. Sotto le soglie del round 12 (150 ms) |
| 7 | bassa | **Invariati dal round 11** (non toccati, dichiarati dall'implementatore): assolo tenuto sull'accordo uguale all'ultimo del foglio (6), sezioni uguali con tagli doppi e rosso al 52% nel tempo libero (8), gap falso di 3,2 s con due sezioni tolte (12). Non rimisurati |
| 8 | bassa | Pochi accordi (intorno a 63 s e a 451–459 s, 100–155 ms dopo il mio attacco in ogni tipo di salto) restano accesi in ritardo: errore del motore su quegli eventi, non dei salti (round 11: max 0,28 s) |

Non sono bug: il browser stima la durata dell'mp3 in 517,0 s contro 513,65 s della scansione (era il sospetto del coordinatore: il seek proporzionale sul VBR; l'app ora non lo usa); l'ogg atterra 24 ms prima (granulo di Vorbis); il silenzio ha un limite di 150 ms e ne resta metà; la sincronizzazione del reale dura 4 s; G3 del mio `round10-tester-nudge` (soglia 12 px, per scelta); 320 px di `round10-tester-nudge` (come nel round 11).

## Verdetto

**Round 12: il lavoro che serviva c'è e funziona, ma c'è una regressione audibile da correggere prima di far riprovare l'utente (bug 1).**

- **(A) Seek esatto: confermato e misurato con un metodo mio.** Ogni modo di salto (sezione, accordo, «Ascolta da qui», pausa e ripresa, 80%, barra, loop) atterra a 0–7 ms (mediana per prova), nessuno oltre 18 ms; prima 0,64–1,70 s. L'evidenziazione sta a +14…+27 ms dal mio attacco (come un Play da 0), nessun clic doppio o mancante, silenzio al salto 48–100 ms e al loop 70–96 ms, URL revocati, nessuna perdita (memoria +118 MB di assestamento: bug 3), altri formati ancora esatti. L'affermazione dell'implementatore sul seek di Chromium è vera (+845/−640/+644/+1697/+1094 ms con il mio metodo) e spiega perché i miei test non la vedevano (A4). **Non si può dire nulla su Firefox/Android**, dove il percorso di decodifica del seek è diverso (vedi sotto).
- **(B) Primo G del Chorus 1: non riproducibile**, né nell'app né in 27 varianti mie, né con il motore del round 11: quindi la correzione non è verificabile in questo ambiente; nel sintetico il confine «in ritardo di un quarto» non è corretto dalla regola (bug 2, media). Le 6 coppie di accordi uguali del reale sono a posto.
- **(C)** Regolazione e informazioni tecniche funzionano (9/9 e 4/4); limiti: i clic non si spostano (5), ultimi 10 s non salvati (4). Nessuna parola del brano nel JSON.
- **(D)** Bug 1, 2, 3, 4, 5, 7, 10 del round 11 risolti; `npm test` 291/291; prova da utente senza blocchi. **Bug 1 di questo round (fine brano) è una regressione**: si vede dopo 8 minuti di ascolto e basta.

## Cosa deve controllare l'utente sul telefono

1. Sincronizza di nuovo, suona dal Verse 1: l'accordo evidenziato deve stare con il suono anche dopo i salti (tocco su un accordo, «Ascolta da qui», pausa e ripresa, loop); se resta in ritardo, aspetta ≥ 30 s di ascolto e 10 s dopo l'ultima azione, poi esporta «Informazioni tecniche» (da libreria → Audio e cuffie) e prova «Prima»/«Più tardi».
2. Il primo G del Chorus 1 (a ~1:03) deve accendersi a ~63,4 s e restare acceso ~0,8 s; se scivola ancora, le informazioni tecniche hanno i tempi dei primi 60 eventi e il metodo di decodifica.
3. Lascia finire il brano: deve fermarsi; se riparte da solo è il bug 1 (finché non è corretto: ferma tu l'ascolto prima della fine).
4. Con il clic acceso prova «Evidenziazione»: l'accordo si sposta, il clic no (bug 5); controlla se il clic è a tempo con il suono o se serve spostarlo.
5. Dopo 20–30 salti di fila l'app deve restare fluida e il silenzio a ogni salto (≤ ~200 ms) non disturbare; su un telefono lento la memoria cresce di ~150 MB.

## Non verificato

- **Firefox e Android reali**: tutto è Chromium (x86, uscita sul dispositivo nullo); in particolare non so se il seek a blob («frame esatto») dà la stessa posizione con il decoder di Firefox (priming di 2257 campioni = 47 ms è quello di Chromium, errore massimo ~23 ms dichiarato dall'implementatore), né quanto dura il silenzio di un salto su un telefono lento, né l'orologio dell'`AudioContext` su Android con il Bluetooth.
- Il ritardo di 0,5 s riportato dall'utente: la causa è plausibile (seek proporzionale sul VBR: lo conferma il +0,6…1,7 s in Chromium) ma non dimostrata per Firefox; l'effetto del round 12 su Firefox è sperimentale finché l'utente non riascolta.
- Lo scivolamento del primo G sul telefono: non riprodotto con nessuna variante (reale, 27 varianti mie, 5 sul motore del round 11, sintetico mio); non so se nasce dalla decodifica, dal motore o da altro.
- Non ho ascoltato: i miei attacchi sono gli attacchi di un flusso spettrale (±20 ms di latenza propria), non i battiti di un musicista; a 0,8× le correlazioni sono più deboli (inviluppo) e gli scarti a ±10 ms.
- Il percorso senza metronomo (elemento collegato direttamente all'uscita) non si può catturare con questo metodo: misuro solo con il clic acceso (stesso `<audio>`, ma con il passaggio da `AudioContext`).
- Barra: solo nella schermata di sincronizzazione (non c'è una barra di scorrimento nella vista del brano); evidenziazione non misurabile lì.
- Reti lente, file con intestazione Xing assente (il reale ha Xing con TOC), memoria su un telefono reale.
