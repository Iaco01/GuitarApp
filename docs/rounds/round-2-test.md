# Round 2 — Tester: riproduzione a tempo e durate (M3 + M4)

Leggi `CLAUDE.md`, `docs/SPEC.md` (riproduzione, milestone 3–4), `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md`, `docs/rounds/round-2-impl.md` e `docs/reports/round-2-impl.md`. Verifica in modo **indipendente e scettico**.

Regole come al round 1: non toccare `src/`, `scripts/` né i test esistenti; i tuoi test vanno in `test/e2e/` (eseguiti a mano) e `test/regression/` (con `todo`); screenshot in `test-artifacts/round-2/`, guardati davvero; nessun testo del brano reale nei file committati; niente push.

Chromium per l'audio: `chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })`. Lo stato del player è leggibile da `window.__gapp`.

## A. Correzioni del round 1
1. Parole spezzate: 0 a scala 1,0 / 1,5 / 2,0, 360 px, Pixel 7 e iPhone 13 (riusa la tua misura del round 1).
2. Testo reso identico a `line.lyric` per tutte le righe (nessuno spazio aggiunto).
3. Span con nome vuoto, 20000 span non chiusi (< 1 s): i tuoi test di regressione ora passano senza `todo`?
4. Icona del tema leggibile; reimport dello stesso file → dialogo Sostituisci / Tieni entrambi / Annulla; "Sostituisci" conserva le durate modificate.
5. Test sul file reale rafforzati (col esatte, 137 righe, 38 accordi con `*`).

## B. Tempo per sezione e timeline (calcoli tuoi, indipendenti)
1. BPM proposti sul file reale: Verse 1 = 62, ogni Chorus = 96, Verse 2…6 = 142. Visibili nelle intestazioni delle sezioni, modificabili, "applica a tutte le sezioni con lo stesso nome" funziona.
2. Ricalcola tu da zero la durata totale del brano in secondi con le durate di default e confrontala con `timeline.totalSec` (tolleranza 1 ms).
3. Speed 50%: tempi raddoppiati.

## C. Precisione (criterio M3: "cambia esattamente sul battito previsto")
1. Riproduci il file reale per almeno 60 s (passando il confine Verse 1 → Chorus: con le durate di default calcola tu quando arriva e, se serve, parti da un accordo poco prima). Registra a ogni frame `timeSec` ed `eventIndex` e confronta l'istante di ogni cambio con lo `startSec` atteso: riporta errore medio e massimo (atteso: entro 1 frame, ~17 ms).
2. Deriva: confronta `timeSec` del player con `performance.now()` trascorso su 60 s. E, sul nucleo puro dello scheduler, simula 5 minuti con un clock finto e verifica che i battiti programmati coincidano con la griglia (errore 0, nessun battito saltato o doppio). Se riesci, intercetta gli `OscillatorNode.start(t)` (monkeypatch di `AudioContext.prototype.createOscillator` prima del caricamento) e verifica che i tempi programmati dei clic coincidano con la griglia.
3. Conteggio iniziale di una battuta; accento sul primo battito della battuta.
4. Cambio di tempo al confine di sezione: i clic cambiano intervallo esattamente lì.

## D. Interfaccia in riproduzione (screenshot)
1. Accordo corrente pieno con barra di avanzamento; prossimo accordo bordato con battiti mancanti sempre visibili.
2. Pannello in basso: accordo corrente, prossimo, pallini della battuta, pattern di ritmo della sezione (Verse 1 con 16 celle, Chorus 8), BPM. Il pannello non copre il testo (l'ultima riga è raggiungibile).
3. Scorrimento: la riga corrente sta nel terzo superiore durante tutto il test. Scorrimento manuale → sospeso ~4 s, poi riprende.
4. Play/pausa/stop, velocità, metronomo on/off, tap tempo (simula 8 tocchi a 500 ms → 120 BPM sulla sezione corrente), tocco su un accordo → ripartenza da lì col conteggio, loop di sezione con pressione prolungata (gira almeno 2 volte, si esce con ×).
5. Sezioni compresse si espandono quando la riproduzione ci entra.
6. Wake Lock: richiesto al play, rilasciato a pausa (monkeypatch di `navigator.wakeLock` per osservarlo); avviso se non supportato.
7. Nessun errore in console; nessun calo vistoso di frame (misura il tempo medio per frame con `requestAnimationFrame` durante il play).

## E. Durate (M4)
1. Battiti per accordo 2/4/8: cambia la timeline; con durate modificate chiede conferma.
2. Modifica a mano con + / −, limiti 1–32, `timingSource: 'edited'`.
3. Copia sulle sezioni uguali: sui Chorus del file reale quante sezioni propone? È giusto? (calcolalo tu con la definizione del piano).
4. Registrazione col tap: simula i tocchi con tempi controllati (esatti e con jitter ±80 ms) su una sezione a 142 BPM e su una a 62: durate risultanti corrette? Tocco doppio ignorato? Anteprima, Salva, Scarta.
5. Tutto persiste dopo reload.

## Report: `docs/reports/round-2-test.md`
Stesso formato del round 1: tabella per punto (PASSA / FALLISCE / NON VERIFICABILE con evidenza numerica), bug numerati per gravità con passi, atteso vs ottenuto e file sospetti, cosa resta non verificabile (audio reale udibile, telefono fisico, Safari). Risposta finale di 15 righe al massimo.
