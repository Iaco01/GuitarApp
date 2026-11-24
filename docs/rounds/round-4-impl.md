# Round 4 — Implementatore: audio sincronizzato (M6)

Leggi `CLAUDE.md`, `docs/SPEC.md` (sezione "Audio sincronizzato", milestone 6), `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md` (in particolare "Tempo per sezione") e i report del round 3.

## 0. Correzioni dal round 3

Vedi la sezione in fondo. Falle per prime, con test.

## 1. Idea di fondo

L'audio diventa l'orologio. La timeline resta quella in battiti con il BPM per sezione; l'audio aggiunge un **offset** (istante dell'audio in cui cade il primo battito del brano) e, facoltativamente, delle **ancore di sezione** (istante dell'audio in cui inizia una certa sezione). Siccome il brano ha BPM diversi per sezione (decisione dell'utente), la sincronizzazione è **a tratti**: ogni sezione ancorata parte esattamente dalla sua ancora; le sezioni non ancorate seguono la precedente col loro BPM.

## 2. Modello

```js
song.audio = {
  fileName, mimeType, size, durationSec,
  offsetSec: 0,                  // ancora della sezione 0 (inizio del primo accordo)
  anchors: { [sectionIndex]: sec },  // ancore facoltative delle altre sezioni
  metronome: false,              // clic sopra l'audio
  addedAt
} | null
```

- Il file audio sta in IndexedDB (`gapp-audio` / `files`, chiave = `song.id`), come `Blob`. Nessun upload, nessuna rete.
- `buildTimeline(song, { speed, anchors })`: se una sezione ha un'ancora, il suo `startSec` è l'ancora (relativa all'inizio dell'audio) e il tempo cumulativo riparte da lì. Le ancore devono essere crescenti; quelle incoerenti vengono ignorate con un warning. Senza audio il comportamento resta quello del round 2 (test esistenti invariati).
- Latenza: impostazione **del dispositivo** in `gapp.device.v1` (`latencyMs`, default 0), non del brano: con cuffie diverse cambia il dispositivo, non la canzone. La spec mette la calibrazione nel campo `audio`; questa scelta la sostituisce (annotala in DECISIONS).
- **Battute di pausa** (intro/assoli senza accordi): in modalità modifica, nell'intestazione di ogni sezione, "+ pausa" inserisce all'inizio della sezione una riga `{ lyric: '', chords: [{ name: 'N.C.', rest: true, beats: 4, col: 0 }] }`. Si modifica con −/+ come gli altri accordi e si elimina. Resa come etichetta grigia "pausa". Niente diagramma, niente colore. Nella timeline conta come un evento senza accordo; il pannello mostra "—".

## 3. Riproduzione con audio (`src/audio.js` + estensione di `player.js`)

- Elemento `<audio>` con `src = URL.createObjectURL(blob)` (revocato quando si esce dal brano). Il clock è `audio.currentTime - latencyMs/1000`, letto in `requestAnimationFrame`; con l'audio la timeline si costruisce con `speed = 1` (il tempo dei media non dipende dalla velocità).
- **Velocità** 50–100%: `audio.playbackRate`, con `preservesPitch = true` (più `webkitPreservesPitch`/`mozPreservesPitch` dove esistono).
- **Accordo corrente** = ultimo evento con `startSec <= t`. Prossimo e battiti mancanti come nel round 2.
- **Tocco su un accordo** → `audio.currentTime = event.startSec` (più la latenza), senza conteggio.
- **Loop di sezione** sull'audio: quando `t >= section.endSec`, salto a `section.startSec`. Controllo nel frame, più un `timeupdate` di riserva.
- **Metronomo sopra l'audio** (spento di default): l'audio passa da `MediaElementAudioSourceNode` nello stesso `AudioContext` del metronomo, e i clic si programmano col lookahead convertendo il tempo dei media in tempo del contesto (`ctxTime = ctx.currentTime + (beatMediaTime - audio.currentTime) / playbackRate`). Ricalcola dopo seek, pausa e cambio di velocità; nessun clic doppio dopo un seek.
- Wake Lock come nel round 2.

## 4. Sincronizzazione (UI "Sincronizza audio")

1. **Carica audio**: input file `audio/*` (mp3, m4a, wav). Mostra nome e durata. Sostituibile ed eliminabile.
2. **Inizio**: l'audio parte; l'utente tocca il grande pulsante "Primo accordo!" quando sente il primo accordo → `offsetSec`. Poi regolazione fine: −50 / −10 / +10 / +50 ms, con "ascolta da qui" che riparte 2 s prima dell'offset con il clic acceso per confrontare.
3. **Ancore di sezione** (facoltative): in modalità sincronizzazione, durante la riproduzione, un pulsante "Inizio sezione: <nome prossima sezione>" fissa l'ancora della sezione successiva. Le ancore si vedono nell'intestazione delle sezioni (⚓ 1:42,3) e si regolano o si tolgono.
4. **Suggerimento BPM**: tra due ancore consecutive (o tra un'ancora e la fine del brano, se l'utente tocca "Fine brano"), `bpmSuggerito = battiTra / (t2 − t1) × 60`. Se differisce dal BPM efficace delle sezioni in mezzo di più di 0,3 BPM, mostra "Le sezioni Verse 2–Verse 3 sembrano a 141,5 BPM (ora 142): applica". Applica → imposta quel BPM su quelle sezioni (`bpmSource: 'edited'`). È la versione a tratti del "prova 0,5 BPM in più" della spec.
5. **BPM** anche con + / − di 0,5 e tap tempo, come nel round 2.
6. **Calibrazione della latenza** (impostazioni del dispositivo): slider −100…+400 ms, valore iniziale proposto da `ctx.outputLatency` se disponibile. Schermata di prova: clic regolari + un cerchio che lampeggia sul battito; l'utente sposta lo slider finché luce e suono coincidono. Testo che spiega di rifarla quando si cambiano cuffie.

## 5. Libreria ed export

- Export JSON: `song.audio` esportato come metadati (senza blob, già così dal round 3). Dopo un import, il brano con `audio` ma senza file in IndexedDB mostra "Audio mancante: ricarica <fileName>"; ricaricando un file con stesso nome e dimensione, offset e ancore si conservano; con nome/dimensione diversi chiedi se tenerli.
- Eliminando un brano si elimina anche il suo audio da IndexedDB.
- Lo spazio usato mostra anche gli MB in IndexedDB (`navigator.storage.estimate()` se disponibile).

## 6. Test

- Node: `buildTimeline` con ancore (sezioni ancorate partono dall'ancora, non ancorate seguono; ancore non crescenti ignorate), suggerimento BPM tra ancore, conversione tempo media → tempo contesto per i clic, loop.
- Per l'e2e genera con `ffmpeg` (presente nel container, solo in fase di test, mai a runtime) una traccia sintetica: un brano breve con 3 sezioni a BPM diversi, dove ogni cambio di accordo è un tono di altezza diversa che inizia esattamente al tempo previsto, con un silenzio iniziale di 1,7 s. Script in `test/fixtures/make-audio.mjs`; WAV e MP3 generati in `test-artifacts/` (non in git). Usa con questa traccia un brano sintetico corrispondente (fixture .mht sintetica nuova o JSON importato).
- Playwright: carica audio, imposta offset 1,7 s (via UI: tocco simulato + regolazione fine), play; misura per ogni cambio di accordo la differenza tra il cambio dell'evidenziazione e l'istante atteso nell'audio. Obiettivo M6: entro 100 ms per tutta la durata, anche al 75%. Verifica `preservesPitch` impostato, salto toccando un accordo, loop, metronomo sopra l'audio senza clic doppi dopo un seek.

## Consegna

Come i round precedenti. In più, nel report: una sezione "Come provarlo sul telefono" in italiano semplice per l'utente (caricare l'mp3, fissare l'inizio, ancore, calibrazione con le cuffie Bluetooth).

## Correzioni dal round 3

(da completare dopo il report del tester)
