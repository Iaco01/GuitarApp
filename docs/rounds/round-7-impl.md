# Round 7 — Implementatore: sincronizzazione automatica dall'audio

Richiesta dell'utente: caricato l'mp3, l'app deve trovare **da sola** inizio, BPM e quando cambia ogni accordo, invece di sincronizzare a mano.

Leggi `CLAUDE.md`, `docs/DECISIONS.md`, `docs/rounds/round-4-impl.md` (modello audio, ancore), `docs/rounds/round-6-impl.md` (durate stimate) e il codice di `src/audiosync.js`, `src/timeline.js`, `src/ui/syncscreen.js`.

## Idea

Non serve riconoscere gli accordi da zero. Il foglio UG dà già **la sequenza esatta** degli accordi: 328 sul brano reale, in ordine, sezioni ripetute comprese. Il problema è un **allineamento forzato**: trovare l'istante d'inizio di ogni evento della sequenza nell'audio. È molto più facile e robusto del riconoscimento libero.

Tutto in JS senza dipendenze, nel browser del telefono, sui campioni decodificati.

## Cosa ha visto il coordinatore sull'mp3 reale

File `/home/user/guitarapp/test/fixtures/local/american-pie.mp3`: 513,7 s, 48 kHz stereo, fuori da git, protetto da copyright, solo per test locali. Un'analisi di tempo a finestre di 16 s (autocorrelazione del flusso spettrale) dà:
- 0:00–~1:50: voce e piano a tempo libero, nessun battito stabile (confidenza bassa);
- ~1:55–2:15: primo ritornello a ~96–99 BPM;
- ~2:20–7:25: band piena a ~136–144 BPM, stabile. **I ritornelli centrali sono anche loro a ~140**, quindi la proposta automatica dai ritmi UG ("tutti i Chorus a 96") è sbagliata per questa registrazione;
- ~7:30–8:33: finale lento, prima a tempo libero poi a ~89–99.

Il risultato automatico deve quindi poter dare **BPM diversi alle sezioni con lo stesso nome** e gestire tratti senza battito stabile.

## Fase A — Motore di analisi (moduli puri, testati in Node)

Cartella `src/analysis/`, moduli puri: niente DOM, ricevono `Float32Array` mono e frequenza di campionamento. Rispetta le convenzioni della build: nomi top-level univoci, `export function`.

1. `fft.js`: FFT reale radix-2 iterativa, con test contro una DFT ingenua.
2. `features.js`:
   - input ricampionato a 11025 Hz mono;
   - STFT (finestra 4096, hop 512, Hann);
   - **flusso spettrale** come inviluppo degli attacchi;
   - **cromagramma** a 12 classi (10 fps circa, energia log-compressa, con stima della **sintonia**, cioè quanto la registrazione è crescente o calante in cent rispetto a La 440, corretta prima di piegare sulle 12 classi);
   - filtro "bass chroma" separato dalle note sotto 200 Hz, utile per i rivolti e per distinguere G da Em.
3. `beats.js`:
   - tempogramma a finestre (8–12 s) con BPM locale e **confidenza**;
   - inseguimento dei battiti con programmazione dinamica (alla Ellis 2007), con tempo che può cambiare tra tratti;
   - nei tratti a bassa confidenza niente griglia di battiti: solo istanti;
   - correzione dell'**errore di ottava** (71 contro 142) usando i BPM UG come indizio debole.
4. `align.js`: allineamento forzato.
   - Stati = eventi della sequenza (accordi; le pause sono eventi a parte con modello "qualunque cosa").
   - Modello sinistra→destra: ogni stato resta o passa al successivo. Si usa Viterbi su frame di cromagramma, a 10 fps, oppure sincronizzati ai battiti nei tratti stabili.
   - **Emissione**: somiglianza coseno tra croma del frame e modello dell'accordo (fondamentale, terza, quinta; settima con peso minore), più il basso.
   - **Durata**: prior morbido dalla stima per sillabe del round 6, convertita in secondi col BPM locale. Penalità per durate molto lontane dal prior, mai vincolo rigido.
   - Ricerca della **trasposizione**: prova le 12 trasposizioni del foglio e tieni la migliore. Riporta "la registrazione è un tono sopra il foglio" se non è 0.
   - Prestazioni: brano di 8,5 minuti × 328 eventi; usa una banda attorno alla diagonale prevista per non fare 328 × 5000 completo se serve. Obiettivo < 3 s in Node.
5. `autosync.js` (orchestratore puro): `analyseAndAlign({ samples, sampleRate, song }) -> result`.
   - `result.eventStartSec[]` e `result.confidence[]` per evento;
   - per ogni sezione: inizio, BPM misurato (o `null` se tempo libero) e confidenza;
   - trasposizione trovata, sintonia in cent, durata del calcolo;
   - durate in battiti ricavate: Δt × BPM locale / 60, arrotondate al battito, solo per le sezioni con battito stabile.

### Banco di prova sintetico (obbligatorio, con verità nota)

`test/fixtures/make-realistic.mjs` genera in `test-artifacts/` un WAV realistico.
- **Strumenti**: chitarra pizzicata con Karplus-Strong a 6 corde e strum giù/su, basso sulla fondamentale, cassa e rullante sintetici, un po' di rumore.
- **Struttura**: una sezione a tempo libero (±15% di rubato), cambi di tempo tra sezioni, una sezione ripetuta a tempo diverso, una battuta di pausa, la registrazione 30 cent crescente e un tono sopra il foglio.
- **Verità**: un JSON con gli istanti veri di ogni cambio.
- **Misure**, in un test Node (`test/autosync.test.js`, con un brano corto per restare veloce) e in uno script più lungo (`test/e2e/autosync-bench.mjs`):
  - percentuale di cambi entro 100 / 250 / 500 ms;
  - errore mediano;
  - BPM per sezione;
  - trasposizione e sintonia trovate.
- **Obiettivi** sul sintetico:
  - ≥ 90% dei cambi entro 250 ms nelle sezioni a tempo stabile;
  - ≥ 70% nella sezione a tempo libero;
  - trasposizione e BPM giusti.

### Sul brano reale (senza verità a priori)

`test/e2e/autosync-real.mjs` decodifica l'mp3 con ffmpeg (solo nel test) e lancia `analyseAndAlign` col brano reale. Riporta:
- inizio di ogni sezione e BPM per sezione;
- trasposizione e sintonia;
- distribuzione delle confidenze e tempo di calcolo.

Controlli di plausibilità, scritti nel report:
- i BPM delle sezioni con la band sono nell'intervallo 130–150;
- le sezioni sono in ordine e senza sovrapposizioni;
- **controllo indipendente locale**: per ogni cambio previsto, il croma medio nei 0,5 s prima e dopo deve somigliare di più all'accordo uscente e a quello entrante rispettivamente. Riporta la percentuale di cambi che lo superano.

Nessun testo del brano nei file versionati. Nel report vanno solo tempi, nomi di sezione e di accordi.

**Fine fase A: commit e report intermedio** in `docs/reports/round-7-impl.md` (sezione "Fase A") con i numeri, prima di toccare la UI.

## Fase B0 — Migliorare l'allineamento sul brano reale (prima della UI)

Dalla Fase A (`docs/reports/round-7-impl.md`):
- sul sintetico il 98% dei cambi cade entro 250 ms;
- sul reale il controllo indipendente locale passa solo per il **57,3%** dei cambi. Le strofe con band piena (Verse 3–5) sono le peggiori (40–51%), mentre la verità sintetica sullo stesso controllo dà 93,5%;
- l'allineamento è grosso modo giusto (spostando i cambi di ±0,9 s il controllo crolla all'8–10%), ma poco preciso;
- solo il 41% dei cambi cade vicino a un battito.

Prima della UI prova, misurando ogni modifica con `test/e2e/autosync-real.mjs` e `autosync-check.mjs` senza peggiorare il banco sintetico:
1. **Aggancio ai battiti** nelle sezioni a tempo stabile: dopo Viterbi, sposta ogni cambio sul battito più vicino (o sul mezzo battito se più vicino ai dati), poi misura di nuovo il controllo locale e la percentuale vicino ai battiti.
2. **Allineamento sincronizzato ai battiti** nei tratti stabili: un frame per battito invece di 10 fps. Riduce il rumore e impone che i cambi cadano sui battiti.
3. **Croma più pulito con band piena**:
   - pesa di più le frequenze 80–1000 Hz;
   - sottrai una stima della media spettrale (whitening) per ridurre batteria e voce;
   - prova uno smoothing mediano corto.
4. **Modelli di accordo**: rivedi il peso del basso (fondamentale al basso) e il modello per gli accordi `*`, la cui grafia è identica ma che nel brano sono rapidi.
5. Il primo evento esce a 0:00,0: verifica se è un artefatto (silenzio iniziale, rumore) e, se sì, togli il silenzio iniziale dal calcolo.
6. Correggi il bias della sintonia (+6/+14 cent).

Riporta una tabella prima/dopo: controllo locale per sezione, % vicino ai battiti, banco sintetico. Tieni solo le modifiche che migliorano. Obiettivo indicativo: controllo locale ≥ 75% sul reale. Se non ci arrivi, dillo e vai avanti con la UI: l'utente correggerà le sezioni gialle.

## Fase B — Integrazione nell'app

- **Modello**: `song.audio.alignment = { version: 1, eventStartSec: [], confidence: [], sections: [{ startSec, bpm, confidence }], transposeFound, tuningCents, createdAt }`.
- **Timeline con audio**: se c'è `alignment`, `startSec` di ogni evento è quello allineato, più l'offset e la latenza. Le ancore manuali, se l'utente le tocca dopo, prevalgono nella loro sezione. L'evidenziazione segue i tempi veri anche nei tratti a tempo libero.
- **Senza audio**, opzionale: "Usa le durate e i BPM misurati dall'audio" porta nel brano le durate in battiti e i BPM per sezione misurati, così si studia col metronomo con i tempi veri.
- **Decodifica nel browser**: `decodeAudioData` sul file in IndexedDB, poi ricampionamento a 11025 Hz mono con `OfflineAudioContext`. Calcolo a pezzi con `await` tra i blocchi per non bloccare la pagina, con barra di avanzamento e "Annulla". Se il telefono non ce la fa, un messaggio chiaro.
- **UI**:
  - nella schermata di sincronizzazione, un pulsante grande "Sincronizza automaticamente" e la barra di avanzamento;
  - poi un riepilogo: sezioni con BPM trovato e colore di confidenza (verde / giallo / rosso), e trasposizione trovata con proposta di applicarla al foglio;
  - pulsanti "Ascolta e controlla" (play dall'inizio) e "Accetta";
  - le sezioni gialle o rosse si correggono con gli strumenti esistenti (ancore, −/+ BPM).
- La sincronizzazione manuale resta disponibile come ripiego.
- **Prestazioni**: misura in Playwright il tempo totale (decodifica + analisi) del brano reale con CPU rallentata ×4, per simulare un telefono (`page.context().newCDPSession` → `Emulation.setCPUThrottlingRate`). Obiettivo < 20 s.

## Consegna

Commit piccoli, test verdi, niente push, messaggi come sempre. Report `docs/reports/round-7-impl.md` con le fasi A e B, tutti i numeri del banco sintetico e del brano reale, i limiti noti, e aggiornamento di `docs/DECISIONS.md` (sezione "Round 7") e del README. Risposta finale di 15 righe al massimo.
