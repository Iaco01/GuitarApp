# Round 12 — Report dell'implementatore

Ultimo round prima della pausa: l'utente riascolta sul telefono (Android, Firefox). Tutti i numeri sono di **Chromium**: qui non ci sono Firefox né Safari. Nessun testo del brano reale nei file; solo tempi, conteggi, nomi di sezione.

## Correzione al quadro del coordinatore

Il file reale **ha** un'intestazione Xing con tabella TOC (LAME 3.100, 21403 frame, 7 071 048 byte): sta nel primo frame, al byte 50 609 (dopo la copertina ID3). Il round 11 aveva guardato solo i primi 4 KB. I frame sono VBR (13 lunghezze diverse). Conseguenza: il seek normale è sbagliato **anche in Chromium** (tabella sotto), non solo dove manca la tabella. Il rimedio (blob che parte da un frame esatto) non dipende dal fatto che ci sia o no l'intestazione.

## 1a. Seek esatto

`src/mp3seek.js` (puro) + `src/audio.js`. Dopo la scansione dell'mp3 (una lettura del file) ogni salto (Play da accordo o sezione, «Ascolta da qui», loop, preroll, ripresa dopo Stop) carica un `Blob` che parte da un frame esatto (3 frame di anticipo per il serbatoio di bit); la posizione è `origine + el.currentTime`. Velocità con `preservesPitch` ri-applicata a ogni sorgente, play/pausa, durata dalla scansione, revoca degli URL ritardata di 10 s (revocare subito faceva crollare il renderer di Chromium dopo alcuni salti: scoperto dall'e2e, 5 volte su 6; corretto). Altri formati e mp3 non riconosciuti: seek normale.

**Priming misurato in Chromium**: la fetta decodificata coincide con la decodifica intera spostata di **2257 campioni** = 1152 (frame Xing) + 1105 (ritardo LAME 576 + 529), per k = 1, 2, 5, 100, 3000, 10000, 20000 e per lead 0 e 3: nessun ritardo proprio della fetta. `frontSamples` è quindi una formula (frame del tag + ritardo del tag LAME + 529), non una misura.

**Errore di posizione** (`test/e2e/round12-seek.cjs` + `round12-seek-analyse.py`; elemento `<audio>` che suona dal mp3 reale, uscita catturata con ScriptProcessor e localizzata per correlazione nella decodifica di ffmpeg; bias del percorso di cattura, +93/+101 ms, sottratto con un Play da 0 senza salto). Errore = posizione dichiarata − posizione vera:

| salto a | prima (`el.currentTime = T`) | dopo (blob da un frame) |
|---|---|---|
| 30 s | +850 ms | −3 ms |
| 63 s | −642 ms | −5 ms |
| 150 s | +652 ms | 0 ms |
| 300 s | +1696 ms | −9 ms |
| 450 s | +1093 ms | −8 ms |

Correlazione 1,00 in tutti i casi. In Chromium il «prima» non è piatto come si pensava: il tempo dichiarato è fuori di 0,6–1,7 s a ogni salto (il segno cambia: la sfasatura non è costante). Il «dopo» sta entro 10 ms (il limite è la risoluzione di `currentTime`).

**Loop**: il silenzio al giro dura **8 ms** (ultimo) e **40 ms** (massimo su 7 salti) in `round12.cjs` (L1; limite 150 ms). **Velocità 0,75**: mantenuta dopo il salto (E3), avanza 1,32 s in 2 s. Pausa/ripresa: continua dallo stesso punto (E4).

**Nell'app, sul reale** (profilo SE, `round11-tester-clicks.cjs SE 100 230` — salto a 100 s con `audioEl.currentTime`, che ora fa il salto esatto — e `round11-tester-clicks-phase.py`, il metodo indipendente del tester): 302 tic in sezioni stabili, 95% entro ±150 ms da un attacco (controllo spostato di mezzo battito: 86%); scarto tic−attacco **mediana +10 ms, p90 27 ms**; pettine su 18 finestre da 12 s: **mediana −12 ms, p90 13 ms, 0 finestre oltre 60 ms** (round 11: −12 ms, p90 17 ms). Cioè dopo il salto l'evidenziazione/i tic stanno sugli attacchi entro 50 ms, come prima del cambio. `round11-tester-real.cjs SE verse1`: nessun «Fuori dal foglio» da 55 a 67 s, cambi del pannello C 54,91 | D 55,24 | G 57,9 | C 64,24 | G 65,49 | D 66,81 | G 68,09 (evento 35 a 63,43 s).

## 1b. Decodifica a pezzi indipendente dal decoder

`src/analysis/stitch.js` (puro) + `src/ui/audiodecode.js`. Pezzi da 45 s che partono da un frame esatto (il frame Xing non va mai al decodificatore), con 1 s di sovrapposizione più 4 frame di anticipo; la posizione di ogni pezzo si trova **correlando** il tratto in comune con quanto è già stato messo (±30 ms, correlazione ≥ 0,9, altrimenti decodifica intera). La linea del tempo è la formula di `mp3seek.js`, la stessa del seek. `alignment.decode = { method, pieceShiftsMs }` per la diagnostica.

`test/e2e/round12-decode.cjs`, Chromium, mp3 reale (12 pezzi, 1345 ms): scarto per pezzo **−0,1 ms × 11** (un campione a 11025 Hz: arrotondamento), scarto massimo contro la decodifica intera dello stesso browser **0,09 ms**; lunghezza 5 662 979 contro 5 662 787 campioni. Sintetici (rumore rosa, 130 s): VBR senza Xing, mono senza Xing, CBR con Info, VBR con Xing → scarti 0, 0 ms; contro la decodifica intera 0,00 / 0,00 / 0,63 / 0,63 ms (i file ffmpeg con tag: 7 campioni).

## 1c. Regolazione «Evidenziazione in anticipo / in ritardo»

Menu ⋯ del pannello di play (solo con audio): «Più tardi» / «Prima» a passi di 50 ms, valore scritto («in anticipo di 150 ms», «in ritardo di 50 ms», «a tempo (0 ms)»), salvato in `gapp.device.v1.latencyMs` (stesso valore della calibrazione, che resta); intervallo **−1000…+1000 ms** (era −100…+400); «Ascolta e regola (5 s)» suona 5 s da mezzo secondo prima del punto corrente e si ferma. Nessun overflow orizzontale (320/SE/13). e2e `round12.cjs` O1–O7.

## 1d. Informazioni tecniche

Libreria → «Audio e cuffie» → «Informazioni tecniche»: JSON scaricato/condiviso e mostrato in un campo di testo. Contenuto: user agent, piattaforma, lingua, `sampleRate`/`baseLatency`/`outputLatency`, latenza impostata, tipo di mp3 (`vbr`, `tag`, frame), durata del browser e della scansione, metodo di decodifica e scarti per pezzo, deriva misurata in play (un campione ogni 10 s: scarto in ms dalla retta e pendenza media/orologio, più lo scarto contro l'`AudioContext` se esiste), numero e durata dei salti, i tempi dei primi 60 eventi. Niente testo del brano, né nomi di accordi, né nome del file (controllato dall'e2e D2). Il lettore salva ogni 10 s l'ultima misura; il bottone legge l'ultima sessione (ascoltare almeno 30 s un brano con audio prima di esportare).

## Aggiunta dell'utente: il primo G del Chorus 1 (evento 35)

`src/analysis/samechord.js`. Fra due accordi uguali consecutivi (anche fra sezioni) il confine è il **riattacco**: attacco forte dopo un tratto in cui l'energia cala, nella finestra [inizio del primo + 0,5 s; inizio del successivo − 0,15 s]; un confine già su un attacco chiaro resta; il primo accordo di una sezione non può durare più di 2,2 volte quello delle sorelle (finestra ristretta); coda e silenzio restano all'accordo che li ha prodotti.

**Non sono riuscito a riprodurre lo scivolamento del telefono**: nessuna variante di decodifica lo dà (tabella). La prova è quindi una simulazione: con il confine dell'evento 35 spostato a mano a 57,95 / 58,5 / 59 / 60 / 61,5 / 62,8 s la regola lo riporta a **63,46 s** (63,43 se già lì). Altri 5 accordi uguali consecutivi del brano (eventi 87, 139, 191, 243: invariati; 295: −0,16 s, vedi tabella dei 328).

Robustezza (evento 35 = inizio del G del Chorus 1; durata = evento 36 − evento 35; motore su campioni mono; tutte con la regola attiva):

| variante | evento 35 | durata |
|---|---|---|
| base 11025 / 22050 / 44100 Hz | 63,433 / 63,434 / 63,433 | 0,79 s |
| soxr 11025 / 22050 | 63,433 / 63,434 | 0,79 s |
| solo canale sinistro 11025 / destro 22050 | 63,433 / 63,435 | 0,79 s |
| ricodifica 64 kbps (11025 / 22050) | 63,435 / 63,435 | 0,79 s |
| ricodifica 128 kbps | 63,434 | 0,79 s |
| spostamento +20 ms / −20 ms | 63,455 / 63,412 | 0,79 s |
| decimazione senza filtro (11025) | 63,433 | 0,79 s |
| guadagno 0,3 | 63,433 | 0,79 s |
| rumore bianco −30 dB / −20 dB | 63,434 / 63,434 | 0,79 s |

In **tutte** l'evento 35 sta fra 63,0 e 63,6 s e dura meno di 1,5 s. Test: `test/round12-samechord.test.js` (5 varianti reali + simulazione dello scivolamento + sintetici; si salta senza fixture). **Cosa non so**: se sul telefono lo scivolamento nasce dalla decodifica, dal motore su un'altra sequenza di campioni o da altro: se l'utente rifà la sincronizzazione ed esporta le informazioni tecniche (tempi dei primi 60 eventi, metodo, scarti) si vede subito.

## 2. Bug del round 11

1. **Evento 306 (bug 1)**: `chromaLead` ristretta (nuova nota che sale nel croma + il basso sale verso la nuova radice; `refine.js`). Evento 306: 473,15 → **473,80 s** (attacco del tester a 473,80); evento 32 tenuto a 53,05 s. Il `todo` del tester è ora un test normale (`test/round12-real-events.test.js`). Il test «attacco entro 0,15 s» proposto non è fattibile: nell'inviluppo del motore quei due cambi non hanno attacchi sopra 2.
2. **Tic nel tempo libero (bug 2)**: un tic accentato per cambio, nessun tic intermedio; il pannello scrive «tempo libero: un tic a ogni cambio» (10 px, al posto della barra; **+7 px** di altezza nelle sezioni libere).
3. **Guardia della pressione lunga (bug 3, 4)**: non più 320 ms; il foglio ignora il rilascio (`pointerup`/`pointercancel`/`mouseup`/`touchend`/`click`) del puntatore che l'ha aperto finché è giù; un nuovo `pointerdown`/`touchstart` la chiude; aperto da un tap nessuna guardia. `round11.cjs press SE`: tutto PASS; `round10-tester-nudge.cjs SE`: 44 PASS, 1 FAIL (G3, tremito di 6 px prima di 500 ms: soglia ora 12 px per scelta del round 11, non è un difetto) — X1/X2/X5/Y0/Y1 passano.
4. **Ritocco di sezione con ancora (bug 5)**: `keepNeighbours` — si spostano solo gli accordi della sezione (test `round12-nudge-anchor.test.js`: senza la correzione fallisce con 5 ms di scarto negli accordi vicini).
5. **«Correggi a orecchio» con 35 accordi (bug 10)**: pulsante non più sticky, su schermi bassi introduzione su 2 righe, chip max 70 px: `round9.cjs corr` K1 **PASS** su SE, 13, 320 (a 320 «Cambio!» intero sopra la barra, screenshot `test-artifacts/round-9/corr-320.png`).
6. **320 px (bug 7)**: i 4 pulsanti del ritocco su una riga (`test-artifacts/round-11/nudge-320-secsheet.png`).

**Restano aperti** (non toccati): bug 6 (assolo tenuto sull'accordo uguale all'ultimo del foglio), bug 8 (sezioni uguali con tagli doppi; rosso del tempo libero 52,4%), bug 12 (gap falso di 3,2 s con due sezioni tolte).

### I 328 eventi, round 11 contro round 12 (stessa decodifica: mono 11025 Hz da ffmpeg, stesso motore del round 11 in un worktree)

- Spostati di più di 20 ms: **2**; di più di 100 ms: **2**. Colori e gap come prima.

| evento | accordo | round 11 | round 12 | giudizio (metodo del tester, `round11-tester-indep.py`) |
|---|---|---|---|---|
| 295 | G (primo del Chorus 12, dopo il G tenuto del Verse 11) | 459,08 | 458,92 | **migliora**: attacchi del tester a 458,87 (forza 18,3) e 459,08 (forza 8,0); il nuovo è sull'attacco forte, il vecchio sul debole (riattacco) |
| 306 | D (Verse 6) | 473,15 | 473,80 | **migliora**: attacco a 473,80, il croma di G collassa a 473,85–473,90 |

## Cosa resta da verificare sul telefono dell'utente (Android, Firefox)

1. **Il ritardo di ~0,5 s è scomparso dopo la risincronizzazione?** Cosa è cambiato: salti esatti (non dipendono da come Firefox stima il seek), decodifica a pezzi con posizione per correlazione, confine fra G uguali sul riattacco. Se resta, esportare «Informazioni tecniche» dopo 30–60 s di ascolto (include `outputLatency`, deriva, scarti, tempi degli eventi) e provare «Evidenziazione» (±50 ms, fino a ±1 s).
2. **Il ritardo fisso del decoder di Firefox** dopo il seek a blob: `frontSamples` (2257 campioni = 47 ms) è quello di Chromium; se Firefox toglie un numero diverso all'inizio del file intero resta uno scarto costante di al massimo ~23 ms (assorbito dal controllo). Si vede nel confronto fra i primi accordi prima e dopo un salto.
3. **Silenzio al giro del loop e ad ogni salto** su telefono (Chromium: 8–40 ms): il blob da 7 MB si ricarica a ogni salto; su un telefono lento potrebbe essere di centinaia di ms (`maxGapMs` nelle informazioni tecniche).
4. **Memoria**: la copia in memoria del file (7 MB) resta per tutto l'ascolto, più le fette finché non si revocano (10 s).
5. **Deriva dell'orologio** (`el.currentTime` contro l'`AudioContext`/orologio di parete): in Chromium sintetico pendenza 0,995 su 20 s (campioni da 10 s, risoluzione ~50 ms), non interpretabile; il dato vero è quello del telefono.
6. **Primo G del Chorus 1** (evento 35) dopo la risincronizzazione: deve accendersi a ~63,4 s e durare ~0,8 s.
7. Tutti i controlli di layout (nuovo menu «Evidenziazione», testo del tempo libero, «Correggi a orecchio») sono verificati solo in Chromium con profili 320/SE/13.

## e2e e test eseguiti

- `npm test`: **291 pass, 0 fail** (erano 274).
- Nuovi: `test/mp3seek.test.js`, `stitch.test.js`, `diagnostics.test.js`, `round12-samechord.test.js`, `round12-real-events.test.js`, `round12-nudge-anchor.test.js`; e2e `round12.cjs` (SE: 22 PASS; 320 e 13 sono passati dopo le correzioni), `round12-seek.cjs`, `round12-decode.cjs`.
- Vecchi e2e: i test che leggono o scrivono `gapp.audioEl.currentTime` funzionano ancora (la vista restituisce la posizione nel file); i nuovi test usano `window.__gapp.audioPlayer`.
- `round10-regress.sh` (59 script: 48 con exit 0, 11 con exit ≠ 0 alla prima passata): dopo le correzioni sotto, restano solo difetti che **non nascono da questo round** (il codice relativo non è stato toccato):
  - `round4` S5 «clic regolari dopo i salti» (clic doppi dopo un salto): **vero difetto mio**, trovato dall'e2e (i clic si programmavano dal clock fermo di una sorgente appena caricata); corretto (`loading` dura fino a `playing`), `round4.cjs` ora ALL PASSED.
  - `round7 flow` (360/SE/13) C4/C5: C4 era mio (il tocco subito dopo `seek` leggeva l'origine del blob, 83 ms prima: la posizione mostrata ora non va mai prima del tempo chiesto), corretto; C5 era un test vecchio (cerca «1 verificate», il testo dal round 11 è «1 verificata a orecchio»): regex aggiornata; `round7.cjs flow SE` ALL PASS.
  - `round8-tester-app panel` H (altezza del pannello da fermo = in play): era mio (+7 px nelle sezioni libere con il testo del tempo libero); corretto passando il flag anche al pannello fermo; ora ALL PASS (e `round7-panel`, `round6 height`).
  - **Non miei, già presenti** (nessun file toccato in quelle parti): `round8 all 360/SE/13` S1 e `round8-tester-app sync 320/360` S1 («righe compatte ≤ 64 px»: 54–94 px, le righe della schermata di sincronizzazione sono su più righe dal round 10 per i testi interi); `round7-tester-app synth` C3c («punto debole atteso» dichiarato nello script) seguito dal clic su `#btn-bpm-up` che dal round 9 è disattivato con l'allineamento (lo script si ferma).
- `round11.cjs all SE`: ALL PASS. `round10-tester-nudge.cjs SE`: 44 PASS, 1 FAIL (G3, voluto). `round9.cjs corr`: ALL PASS (SE, 13, 320). `round11-tester-nudge.cjs 320 btn`: ALL PASS.
