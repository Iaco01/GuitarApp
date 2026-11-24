# Round 2 — Implementatore: riproduzione a tempo e durate (M3 + M4)

Leggi `CLAUDE.md`, `docs/SPEC.md` (sezioni "Riproduzione a tempo" e milestone 3–4), `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md` e i report del round 1 (`docs/reports/round-1-impl.md`, `docs/reports/round-1-test.md`).

## 0. Correzioni dal round 1

Vedi la sezione "Correzioni" in fondo a questo file (scritta dal coordinatore dopo il report del tester). Falle **prima** del resto, ciascuna con un test che la copre.

## 1. Tempo per sezione (decisione dell'utente)

Il BPM non è più uno solo: ogni sezione può avere il suo.

- Modello: `section.bpm: number|null` e `section.bpmSource: 'strumming'|'edited'|null`. `song.bpm` resta il BPM di partenza del brano. Aggiorna `createSong`/`migrateSong`/`validateSong` (`schemaVersion: 2`; la migrazione da 1 aggiunge i campi vuoti e applica la proposta qui sotto).
- **BPM efficace** della sezione i: `section.bpm` se presente, altrimenti quello efficace della sezione precedente, altrimenti `song.bpm`, altrimenti 80.
- **Proposta automatica dai ritmi UG** (`proposeSectionTempos(song)` in `model.js`, pura), applicata all'import:
  1. Pattern con nome uguale al nome di una sezione (`"Verse 1"`) → quella sezione.
  2. Pattern con nome uguale al nome base (`"Chorus"`) → tutte le sezioni con quel nome base.
  3. Pattern `"<Nome> onwards"` (anche `"<Nome> on"`, maiuscole indifferenti) → la sezione `<Nome>` e tutte le successive che non hanno già un BPM da una regola 1 o 2.
  4. Regola più specifica vince: 1 > 2 > 3.
  - Sul file reale risultato atteso: Verse 1 = 62; tutti i Chorus = 96; Verse 2…Verse 6 = 142. Asseriscilo nel test sul file reale.
  - Ogni sezione riceve anche il suo pattern di ritmo (stesse regole), da mostrare nel pannello: `section.strumIndex: number|null` (indice in `song.strumming`).
- Nell'interfaccia: il BPM della sezione si vede nell'intestazione del riquadro sezione ("♩ = 96") e si modifica toccandolo (campo numerico + "applica a tutte le sezioni con lo stesso nome"). Il BPM globale nell'intestazione del brano diventa "BPM di partenza".

## 2. Timeline: `src/timeline.js` (puro)

```js
buildTimeline(song, { speed = 1 } = {}) -> {
  events: [{ ref: 's.l.c', name, mark, rest, sectionIndex, startBeat, beats, startSec, durSec, bpm }],
  beats:  [{ index, timeSec, sectionIndex, eventIndex, beatInBar, isDownbeat }],   // griglia di tutti i battiti
  sections: [{ index, startSec, endSec, startBeat, endBeat, bpm }],
  totalBeats, totalSec
}
eventIndexAtTime(timeline, sec) -> index | -1      // ricerca binaria; -1 prima dell'inizio
beatIndexAtTime(timeline, sec) -> index | -1
```

- I secondi si calcolano sezione per sezione col BPM efficace; `speed` (0.5–1) scala il tempo (`sec / speed`).
- `beatInBar` riparte da 0 all'inizio di ogni sezione (le sezioni UG iniziano in battere) e conta modulo `timeSignature[0]`.
- Gli accordi con `beats` frazionari non sono ammessi: `beats` è intero ≥ 1.
- Test: totali sul file reale con le durate di default (328 × 4 = 1312 battiti), cambio di tempo esatto al confine Verse 1 → Chorus, ricerca binaria ai bordi (esattamente sul cambio l'accordo corrente è il nuovo), speed 0.5 raddoppia i tempi.

## 3. Metronomo e player: `src/player.js`

- **Scheduler** separato in un nucleo puro testabile (`createSchedulerCore({ beats, lookahead })` → dato `now` restituisce i battiti da programmare e avanza) e una parte Web Audio (oscillatore breve, ~1 kHz accento / ~800 Hz normale, inviluppo 30 ms). Timer `setInterval` 25 ms, finestra 100 ms, come da spec.
- `AudioContext` creato al primo play (sblocco iOS). Gestisci `suspended` → `resume()`.
- **Clock**: la posizione è `(ctx.currentTime - startCtxTime) + startOffsetSec`, letta in `requestAnimationFrame`. L'evidenziazione si calcola solo da qui. Compensazione visiva: sottrai `ctx.outputLatency || ctx.baseLatency || 0`.
- **Conteggio**: una battuta di clic prima di partire, al BPM della sezione di partenza; durante il conteggio il pannello mostra "4, 3, 2, 1".
- Funzioni: play / pausa (riprende dal punto), stop (torna all'inizio), partenza da un accordo (tocco su un accordo in riproduzione o in pausa → riparte da lì col conteggio), velocità 50–100% (passo 5%), metronomo udibile on/off (in assenza di audio il clock gira comunque), loop di una sezione (pressione prolungata ≥ 500 ms sull'intestazione della sezione → loop attivo, evidenziato, ripetuto senza conteggio; tocco su "×" per uscire).
- **Tap tempo**: pulsante nel pannello; media degli ultimi 4 intervalli, reset dopo 2 s di pausa; imposta il BPM della sezione corrente (`bpmSource: 'edited'`).
- **Wake Lock**: `navigator.wakeLock.request('screen')` al play, rilasciato a pausa/stop, richiesto di nuovo su `visibilitychange` se si sta suonando. Se non supportato, avviso una sola volta ("lo schermo potrebbe spegnersi").
- Espone per i test `window.__gapp = { player: { state, timeSec, eventIndex, beatIndex }, timeline }` (solo lettura, aggiornato a ogni frame). Il tester lo userà per misurare.

## 4. Vista in riproduzione

- **Accordo corrente**: etichetta piena, ingrandita, con barra di avanzamento sotto che si riempie sui suoi battiti. **Prossimo**: bordato, con un badge col numero di battiti mancanti al cambio.
- **Pannello fisso in basso** (non copre il testo: aggiungi padding in fondo alla pagina pari alla sua altezza): accordo corrente grande, prossimo accordo + battiti mancanti, pallini della battuta (quello corrente acceso, il primo accentato), pattern di ritmo della sezione (frecce ↓ ↑ con le celle `onBeat` evidenziate; nascosto se la sezione non ha pattern), BPM della sezione, play/pausa, stop, velocità, metronomo on/off, tap tempo.
- **Scorrimento**: la riga corrente resta nel terzo superiore, `scrollTo({ behavior: 'smooth' })` solo quando la riga cambia. Se l'utente scorre a mano, sospendi lo scorrimento automatico per 4 s.
- Le sezioni compresse ("come sopra", "×N") si espandono quando la riproduzione ci entra; si possono ricomprimere a fine riproduzione.

## 5. Durate (M4)

- **Battiti per accordo globale**: 2 / 4 / 8 nelle impostazioni del brano. Cambiarlo riscrive tutti i `beats`; se `timingSource !== 'default'` chiede conferma ("perderai le durate modificate").
- **Modalità modifica** (interruttore "Modifica durate"): il player si ferma; ogni accordo mostra i suoi battiti; tocco su un accordo → piccolo controllo `−  4  +` (min 1, max 32). `timingSource` diventa `'edited'`.
- **Copia sui ritornelli identici**: nell'intestazione della sezione in modifica, "Copia durate su N sezioni uguali" — sezioni con lo stesso nome base e la stessa `sectionSignature`. Il pulsante compare solo se N ≥ 1.
- **Registrazione col tap** (`src/taprecord.js`, nucleo puro + UI):
  - Si sceglie una sezione (o tutto il brano) e si preme "Registra". Parte il conteggio, poi il metronomo dall'inizio della sezione. Il primo accordo inizia sul primo battito.
  - Un pulsante grande ("Cambio!", metà inferiore dello schermo) a ogni tocco segna l'inizio dell'accordo successivo. Mostra accordo atteso e successivo.
  - `quantizeTaps({ tapTimesSec, timeline, firstEventIndex, eventCount }) -> beats[]`: ogni tocco si converte in posizione in battiti usando la griglia (che tiene conto del BPM per sezione), si arrotonda al battito più vicino, e le durate sono le differenze (minimo 1; tocchi doppi entro 1 battito ignorati). L'ultimo accordo finisce col tocco successivo, o con "Fine" (arrotondato), o, se manca, tiene la durata precedente.
  - Alla fine: anteprima delle durate nuove vs vecchie, "Salva" / "Scarta". Salva → `timingSource: 'recorded'`.
  - Test sul nucleo puro: tocchi esatti, tocchi con jitter ±80 ms a 142 BPM, tocco doppio, sezione con cambio di tempo, tocchi mancanti.
- Tutte le modifiche si salvano subito (`saveSong`) e restano dopo il reload.

## 6. Prestazioni

- Nessun lavoro pesante nel frame: precalcola la mappa `ref → elemento` una volta, aggiorna solo le classi degli elementi che cambiano.
- La timeline si ricostruisce solo quando cambiano durate/BPM/velocità.

## Consegna

- Commit piccoli, test verdi, niente push. Messaggi come al round 1.
- Verifica tu stesso con Playwright (Chromium con `args: ['--autoplay-policy=no-user-gesture-required']`): play sul file reale per 20 s, controlla con `window.__gapp` che l'accordo cambi nei tempi attesi dalla timeline; screenshot del pannello in riproduzione e della modalità modifica, guardali.
- `docs/reports/round-2-impl.md` e risposta finale di 10–15 righe.

## Correzioni dal round 1

Dal report `docs/reports/round-1-test.md`. I numeri sono quelli dei bug del tester.

1. **IMPORTANTE — parole spezzate a metà a fine riga** ("tim/e", "cou/ldn't"): fino a 14 casi a scala 1,5–2,0 sul file reale. Causa: un accordo che cade dentro una parola apre un nuovo `inline-block`, e il browser può andare a capo tra un inline-block e l'altro. Regola corretta: **la riga può andare a capo solo dove il testo ha uno spazio**. Quindi ogni parola del testo (sequenza senza spazi), insieme a tutti i segmenti-accordo che cadono dentro di lei, va in un contenitore `white-space: nowrap` (es. `<span class="w">tim<span class="seg"><span class="ch">G</span>e</span></span>`). Gli spazi tra le parole restano fuori, come punti di a capo. Accordi oltre la fine del testo: un gruppo a sé. Aggiungi a `test/segments.test.js` un test che verifica che nessun confine di gruppo cada dentro una parola, e verifica con Playwright a scala 1,0 / 1,5 / 2,0 su 360 px che **0** parole siano spezzate (puoi riusare la misura di `test/e2e/ui-round1.cjs`).
2. **Spazio segnaposto per accordi sopra uno spazio** (`s.word || ' '` in `src/render.js`): l'accordo deve ancorarsi al carattere spazio già presente, senza inserirne un altro. Il testo non deve mai avere spazi doppi che non c'erano nell'originale. Test: per ogni riga del file reale, il testo visibile reso (senza le etichette) è uguale a `line.lyric` (a meno degli spazi finali).
3. **Span accordo con nome vuoto** (`analyseSpanLine` in `src/parser.js`): si ignora, con un warning. Togli il `todo` dal test di regressione relativo e spostalo in `test/parser.test.js`.
4. **Prestazioni quadratiche** con molti span non chiusi (20000 → 14,7 s): rendi lineare l'analisi; il test di regressione deve stare sotto 1 s. Spostalo in `test/parser.test.js` togliendo il `todo`.
5. **Icona del tema** illeggibile (◐ minuscola): usa un'icona SVG inline chiara (sole/luna) di almeno 24 px o un'etichetta testuale "Chiaro"/"Scuro".
6. **Reimportare lo stesso file crea un duplicato**: se esiste già un brano con lo stesso `source.url` (o, se assente, stesso titolo + artista), chiedi "Questo brano è già in libreria: Sostituisci / Tieni entrambi / Annulla". "Sostituisci" mantiene `id`, `view`, durate modificate (se la struttura degli accordi è identica) e BPM modificati; altrimenti avvisa che le durate tornano predefinite. Salva l'URL di origine in `source.url` all'import (dall'header `Snapshot-Content-Location`, senza i parametri di tracciamento `?_gl=…`).
7. **Test deboli sul file reale**: `col` va verificata in modo esatto (non `<= len+20`), il numero di righe salvate deve essere esatto (137) e vanno contati anche i 38 accordi con `mark: "*"` oltre alle 22 righe.
