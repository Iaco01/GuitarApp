# Report round 2 — tester

Verifica indipendente di M3 + M4 su `dist/index.html` (build del commit `d79c07e`) e sul file reale. Nessun testo del brano reale è riportato qui né nei test committati. Screenshot in `test-artifacts/round-2/` (prefisso `t-`, non versionati, guardati con lo strumento Read: conteggio, riproduzione, loop, sezione compressa aperta, pannello iPhone 13 a 1,5, modifica, anteprima registrazione, dialogo duplicato, avviso senza Wake Lock).

Script miei (a mano, non in `npm test`):
- `node test/e2e/round2-tester-core.mjs` — nuclei puri in Node: tempi, durata totale, scheduler 5 min con clock finto, quantizzazione dei tocchi, tap tempo.
- `node test/e2e/round2-tester-parser-perf.mjs` — tempi del parser su input ostili.
- `node test/e2e/round2-tester-ui1.cjs` — A (parole spezzate, testo = lyric, icona, dialogo di reimport) e C (65–75 s di riproduzione, clic intercettati con monkeypatch di `createOscillator`/`start`).
- `node test/e2e/round2-tester-ui2.cjs` — D (pannello, scorrimento, velocità, metronomo, tap tempo, loop, sezioni compresse, Wake Lock con `navigator.wakeLock` simulato).
- `node test/e2e/round2-tester-ui3.cjs [E|E2|P]` — E (durate, copia, registrazione col tap, persistenza) e ingombro del pannello.
- `node test/e2e/round2-tester-ui4.cjs` — casi limite del trasporto. `round2-tester-dump.cjs` stampa solo numeri della struttura.
- `node --test "test/regression/*.test.js"` — un test `todo` (bug 1).

`npm test`: 98/98 verdi. Nessun file in `src/`, `scripts/` o nei test esistenti è stato toccato.

## Esiti

| Punto | Esito | Evidenza |
| --- | --- | --- |
| A1 parole spezzate | PASSA | 0 su 882 parole a scala 1,0 / 1,5 / 2,0 su Pixel 7, iPhone 13 e 360 px (scala impostata coi pulsanti A+/A−); nessuno scroll orizzontale. |
| A2 testo = `line.lyric` | PASSA | 137 righe su 137 identiche (confronto esatto, senza nemmeno il taglio degli spazi finali), etichette escluse. |
| A3 regressioni round 1 | PASSA | I miei due test (span senza nome, 20000 span) passano senza `todo`. Misure mie: 20000 span non chiusi 27 ms, 100000 → 76 ms, 20000 chiusi/vuoti/annidati/righe corte 12–76 ms. |
| A4 icona e reimport | PASSA | Icona SVG 24×24 più etichetta «Scuro/Chiaro». Dialogo con Sostituisci / Tieni entrambi / Annulla; Annulla ed Esc non cambiano la libreria; Tieni entrambi → 2 voci; Sostituisci → 1 voce, durata modificata (6 battiti) e `timingSource: edited` conservati, `source.url` senza `_gl`/`utm`. Vedi osservazione 3. |
| A5 test sul file reale | PASSA | 137 righe salvate, 135 righe accordi (133 con testo, 2 strumentali) e `col` esatte con `parser-independent.mjs` (0 differenze); `real-fixture.test.js` ora esatto. |
| B1 BPM per sezione | PASSA | Verse 1 = 62, ogni Chorus = 96, Verse 2…6 = 142, visibili nelle intestazioni. Modifica da campo con «Applica a tutte le sezioni «Chorus» (6)» (stesso nome): cambiate le sezioni 1,3,5,7,9,11, anche durante il play, che continua. |
| B2 durata totale | PASSA | Calcolo mio: 328 accordi × 4 battiti, 1312 battiti, **722,2092 s**; `timeline.totalSec` 722,2092 s. Inizio di tutti i 328 accordi: errore massimo 1,4e-12 s. |
| B3 velocità 50% | PASSA | Totale 1444,418 s (= 2 × 722,209) nel modulo e nell'app; limite 50% (5 passi da 100, non scende oltre). In e2e a 50%: `timeSec` avanza a 1,0008 s/s sulla timeline stirata, accordo atteso = ottenuto; clic a 1,25 s (96 BPM al 50%). |
| C1 precisione | PASSA | 67 s di play (partenza al 31° accordo di Verse 1, attraversati Verse 1→Chorus a 135,5 s e Chorus→Verse 2 a 175,5 s): 28 cambi, nessun salto, ordine corretto; errore rispetto a `startSec` **medio 4,4 ms, massimo 15,7 ms, minimo 0,9 ms** (entro 1 frame); in tempo reale (`performance.now`) scarto massimo 36,6 ms su 67 s per la deriva del punto 2. Evidenziazione nel DOM = `eventIndex` in 4353 frame su 4353. |
| C2 deriva e griglia | PASSA | `timeSec` avanza 72,571 s contro 72,597 s di orologio: −25 ms su 72,6 s (−0,035%, orologio audio contro `performance.now`; il player usa solo l'orologio audio, quindi non è una deriva interna). Scheduler puro, 5 min con timer simulato in ritardo fino a 30 ms: 469 battiti su 469, errore sulla griglia 0, 0 doppi, 0 saltati; stallo del timer di 90 ms: 0 clic persi (200 e 400 ms: 1). Clic reali intercettati (`osc.start(t)`): 116 clic, scarto massimo dalla griglia 0,000 µs, 0 errori di accento. |
| C3 conteggio e accento | PASSA | 4 clic di conteggio a 0,9677 s (62 BPM), solo il primo a 1000 Hz, il primo battito arriva esattamente una battuta dopo l'ultimo clic di conteggio; accento = primo battito di ogni battuta e `beatInBar` riparte da 0 in ogni sezione. |
| C4 cambio tempo | PASSA | Intervallo dei clic 0,9677 s → 0,6250 s esattamente sul primo battito del Chorus (nella griglia e nei clic reali). |
| D1 corrente/prossimo | PASSA | Corrente pieno con barra (35%→55% in 0,8 s); prossimo bordato con badge dei battiti mancanti nel pannello (il badge non c'è nel testo, solo nel pannello). |
| D2 pannello | PASSA | Corrente, prossimo, 4 pallini (1 acceso, il primo con bordo accento), pattern con **16 celle in Verse 1 e 8 nel Chorus** (cella corrente evidenziata), BPM. Ultima riga e «Elimina brano» raggiungibili sopra il pannello su Pixel 7, iPhone 13, 360 px a scala 1,0 e 1,5. |
| D3 scorrimento | PASSA con riserve | Su 139 campioni (35 s) la riga corrente è sempre interamente visibile, con il bordo alto tra 0,33 e 0,38 dell'altezza: il bordo alto sta al confine del terzo superiore, la riga (che a volte va a capo) ne esce in basso (84 campioni su 138 dentro il terzo + 60 px). Rotella: scorrimento automatico fermo (y 1246 → 1246 in 2,5 s) e ripreso 4,6 s dopo, al cambio di riga. |
| D4 comandi | PASSA | Pausa tiene la posizione (41,25 s fermo), ripresa col conteggio sullo stesso accordo; stop; metronomo: 3 clic in 3 s on, 0 off, orologio e evidenziazione continuano; **tap tempo 8 tocchi a 500 ms (in pagina) → 120 BPM** sulla sezione corrente, `bpmSource: edited`, play continua; tocco su accordo in play → conteggio e ripartenza dall'accordo (evento 20, `timeSec` 77,43 contro 77,42); loop: nessun loop a 300 ms, attivo a 800 ms, **2 giri in 62 s** dentro 135,5–175,5, uscita con «× Loop» e il play prosegue; fine brano → `stopped`, tempo 0. |
| D5 sezioni compresse | PASSA | La sezione «Chorus — come sopra» si apre (`open`, `playing`), l'accordo corrente è visibile; allo stop si richiude. |
| D6 Wake Lock | PASSA con riserve (bug 1, 2) | Richiesto al play (1 richiesta), rilasciato a pausa e a stop; `visibilitychange` con lock già attivo non ne crea un secondo; senza supporto l'avviso compare una sola volta. Ma: pausa prima che la richiesta sia concessa lascia il lock attivo (bug 1); l'avviso non è visibile durante il play (bug 2). |
| D7 console e frame | PASSA | 0 errori/avvisi in tutti gli script. Durante 67 s di play: tempo medio per frame 16,68 ms, p99 18,7 ms, massimo 71 ms, 2 frame su 4352 oltre 34 ms (Chromium headless, CPU non limitata). |
| E1 battiti per accordo | PASSA | 2 → 361,1 s, 8 → 1444,4 s, 4 → 722,2 s (attesi). Con durate modificate: «Perderai le durate modificate. Continuare?»; Annulla le conserva, OK riporta tutto al valore scelto e `timingSource: default`. |
| E2 modifica a mano | PASSA | − da 4 sceglie 1 e si ferma, + si ferma a 32; `timingSource: edited`; il totale della timeline coincide col mio ricalcolo (728,459 s dopo le modifiche). |
| E3 copia sezioni uguali | PASSA | Cliccato davvero. 9 pulsanti: Chorus 1,…,5 (indici 1,3,5,7,9) propongono 4 sezioni, Verse 2…5 propongono 3, Verse 1, Verse 6 e Chorus 6 nessuna: coincide col mio calcolo con la definizione del piano (stesso nome base e stessa sequenza di nomi accordo; Chorus 6 ha 33 accordi contro 16 e Verse 1/6 hanno sequenze diverse). Dopo il clic sul Chorus 1 (primo accordo portato a 6): le 4 sezioni indicate hanno le stesse durate, le altre 7 sono intatte, `timingSource: edited`. |
| E4 registrazione col tap | PASSA | Tocchi simulati in pagina sul tempo del player, «Fine» per l'ultimo accordo. Verse 2 a 142 BPM: durate 4,4,2,1,3,4,2,2 registrate esatte; con jitter ±80 ms (4,2,2,1,1,4,3,2) esatte; Verse 1 a 62 BPM esatte (4,4,2,4,3,4) e con jitter ±80 ms e un tocco doppio a 60 ms (4,2,4,4,1,4) esatte. Gli accordi non registrati restano invariati (anteprima: «6 accordi cambiati su 36», righe modificate bordate). Salva → `recorded`; Scarta lascia i dati e il `timingSource` invariati. Anche a velocità 50% (4,2,4,2). Nucleo puro: 142 e 62 BPM con e senza jitter, tocco doppio, 12 durate varie con jitter, tocchi attraverso il cambio di tempo: tutto corretto. |
| E5 persistenza | PASSA | Dopo reload restano durate modificate, registrazioni (`recorded`), tempi e `timingSource`. |
| Wake lock «Copia durate» cliccato, velocità < 100% in e2e, deriva su durata | vedi sotto | I punti ammessi come non verificati dall'implementatore: wake lock (simulato, vedi D6), «Copia» (E3, PASSA), velocità 50% (B3/E4, PASSA), deriva (C2, solo 72 s in browser e 5 min sul nucleo puro). |

## Ingombro del pannello in riproduzione

Misurato in play con il testo scorso a regime (righe di brano = blocchi `.line`, una riga che va a capo conta uno):

| Profilo (viewport emulato) | Altezza pannello | Quota | Righe intere visibili a 1,0 | a 1,5 |
| --- | --- | --- | --- | --- |
| Pixel 7 (412×839) | 163 px | 19% | 12 | 5 |
| iPhone 13 (390×664) | 163 px | 25% | 8 | 3 |
| 360×780 | 181 px | 23% | 8 | 4 |

Il pannello occupa tre righe di pulsanti (il «Tap tempo» va a capo da solo) più accordo corrente, pallini e pattern. Giudizio: accettabile in verticale su Pixel 7 e a scala 1,0, al limite su iPhone 13 a 1,5 (tre righe: la corrente e due successive, con l'accordo prossimo già nel pannello). Su un leggio, dove si guarda da lontano e si usa 1,5 o più, conviene guadagnare spazio: portare Tap tempo sulla stessa riga dei comandi o nascondere velocità/tap/metronomo dietro un'icona durante il play. Non è un bug.

## Bug (per gravità)

Nessun bug importante. Tutti i criteri M3 e M4 misurabili in Chromium sono rispettati.

**1. MINORE — Pausa prima della concessione del Wake Lock lascia lo schermo bloccato acceso.** Passi: `navigator.wakeLock.request` con risposta lenta (400 ms); Play, Pausa dopo 100 ms. Atteso: nessun lock in pausa. Ottenuto: richieste 3, rilasci 2, lock attivo fino al successivo stop/play. Causa: `acquireWake` assegna `wakeLock` dopo l'`await` anche se nel frattempo `releaseWake` (che trova `wakeLock` nullo) è già passato. In pratica la finestra è di pochi ms su un telefono vero, ma pausa/play rapidi sono comuni. File: `src/player.js` (`acquireWake`, `releaseWake`). Riproduzione: `test/regression/round2-player.todo.test.js` (`todo`, fallisce) e `ui2` «D6-pause-before-lock-granted-does-not-leak». Correzione: ricontrollare lo stato dopo l'`await` (rilasciare subito se non si sta suonando).

**2. MINORE — L'avviso «lo schermo potrebbe spegnersi» non si vede mentre si suona.** Appare nell'area avvisi in cima alla pagina, che durante il play scorre fuori vista (lo scorrimento automatico porta la riga corrente nel terzo superiore). Atteso: avviso visibile (spec: «avviso se non supportato»). Ottenuto: presente nel DOM una volta sola, ma sotto la soglia di visibilità dopo il primo scorrimento (screenshot `t-d-nowakelock.png` lo mostra solo perché la pagina è ancora in cima). File: `src/ui/songview.js` (`showNote` / `onNotice`). Suggerimento: mostrarlo nel pannello o in un toast fisso.

**3. OSSERVAZIONE — «Sostituisci» con due copie dello stesso brano agisce su una sola, la più recente.** Dopo «Tieni entrambi» le due copie hanno lo stesso URL; un terzo import chiede una sola volta e «Sostituisci» tocca la prima trovata da `findExisting` (la più recente), mentre la copia con le durate modificate può restare com'era. Non è un errore per il caso d'uso singolo ma può sorprendere. File: `src/main.js` (`findExisting`).

**4. OSSERVAZIONE — Scorrimento: la riga corrente sta *sul* confine del terzo superiore, non dentro.** Bordo alto della riga a 0,33–0,38 dell'altezza (spec: terzo superiore). Con righe che vanno a capo la parte bassa della riga cade nel terzo centrale. Funziona e non salta; se si vuole il senso letterale basta puntare a 0,25.

**5. OSSERVAZIONE (comportamento previsto, da conoscere) — Un tocco mancato nella registrazione sfasa tutti gli accordi successivi.** Con un tocco saltato l'accordo registrato prende il doppio dei battiti e quelli dopo scalano di uno; l'anteprima mostra le differenze (e si può scartare), ma non c'è un avviso. Il tocco doppio è invece ignorato correttamente.

## Cosa resta non verificabile

- Audio udibile: in Chromium headless si verificano solo i tempi programmati degli oscillatori (esatti), non il suono né la latenza di uscita reale; la compensazione `outputLatency || baseLatency` non è provabile.
- Telefono fisico e Safari/iOS: sblocco di `AudioContext` al primo tocco, Wake Lock reale (qui simulato con un finto `navigator.wakeLock`), rilascio al blocco schermo, throttling di `setInterval`/`requestAnimationFrame` con schermo spento o scheda in secondo piano (un timer fermo oltre ~150 ms perde clic: il nucleo lo ha mostrato con 1 clic perso a 200 ms).
- Deriva su 5 minuti in browser: misurati 72 s (−25 ms tra orologio audio e `performance.now`); i 5 minuti sono verificati solo sul nucleo puro con clock finto, e il criterio «5 minuti senza scarti udibili» richiede ascolto su telefono.
- Prestazioni su telefono: frame misurati su Chromium desktop senza limite di CPU.
- Tocchi reali col dito: i tocchi del registratore sono simulati con click in pagina allineati al player (frame-quantizzati, ±17 ms); la latenza di tocco su touch screen non è misurata.
