# Decisioni

Registro delle scelte che la spec non fissa. Formato: data, decisione, motivo. Chi aggiunge una voce indica il round.

## Round 0 (coordinatore)

- **Parser senza DOM.** Il parser lavora su stringhe invece di usare `DOMParser`, così i test girano in `node --test` senza dipendenze. Il file reale è HTML serializzato da Chrome, abbastanza regolare per un'analisi mirata.
- **Build per concatenazione** dei moduli in un unico `<script type="module">`, con controllo dei nomi duplicati. Evita un bundler e resta un singolo file da aprire sul telefono.
- **Pubblicità nel `<pre>`** e **annotazioni `*`** nelle righe accordi: gestite esplicitamente (vedi piano), perché presenti nel file reale.
- **Ritmo con celle `onBeat`**: le celle di strumming salvano direzione e se cadono sul battito, perché il file reale ha pattern da 16 e da 8 celle.
- **Colori accordi** assegnati in ordine di prima comparsa da una palette fissa (per radice si avrebbero collisioni, es. A e Am).
- **Tempo per sezione** (deciso con l'utente): il file reale ha 62 / 96 / 142 BPM. Ogni sezione può avere un BPM proprio, proposto dai ritmi UG e modificabile; il metronomo cambia tempo al cambio di sezione; la sincronizzazione audio diventa a tratti. Dettagli al round 2. Il parser intanto salva tutti i pattern.
- **Hosting sul telefono**: da decidere quando si arriva alle prove su telefono. Per ora sviluppo e test in locale.

## Round 1 (implementatore)

- **`npm test` usa un glob**: `node --test "test/*.test.js"`. Con Node 22 `node --test test/` tratta `test/` come un file e fallisce (MODULE_NOT_FOUND); il solo `node --test` eseguirebbe anche `make-fixtures.mjs` e gli script e2e sotto `test/`. CLAUDE.md dice ancora `node --test test/`: da aggiornare.
- **"22 accordi con `mark: '*'`"** del piano è stato letto come **22 righe** con almeno un accordo marcato (nel file reale i `*` sono su 38 accordi, in 22 righe). Il test asserisce 22 righe.
- **Titolo/artista**: si preferisce l'h1 (`tabHeader-h1`/`tabHeader-h2`), poi il Subject, poi `<title>`, come da analisi del file reale (il passo 7 del piano dice l'opposto: vale l'analisi). Se il titolo viene dal Subject ed è tutto maiuscolo, viene portato in iniziali maiuscole.
- **Righe vuote** non vengono salvate (separano soltanto): una riga accordi seguita da riga vuota è strumentale.
- **Annotazioni** (`*`, `x2`, `N.C.`, …) fuori dagli span si attaccano all'accordo che precede (più token uniti da spazio). Annotazioni prima del primo accordo sono ignorate. Nel fallback testo `Em*` è accordo `Em` con `mark: "*"`.
- **Riga con span accordo e parole** (accordo inline nel testo) non è riga accordi: resta testo.
- **Nuovo modulo puro `src/segments.js`** (algoritmo a segmenti, testabile in Node) e `groupRepeatedSections` in `model.js`. `src/ui/dom.js` è l'helper DOM.
- **Ripetizioni**: sezioni consecutive con stesso nome base e stesso contenuto (testo e accordi) si fondono in "Chorus (×N)"; una sezione il cui contenuto è già comparso prima diventa un `<details>` "… — come sopra". Interruttore per brano in `view.collapseRepeats` (default attivo). Nel file reale 3 sezioni su 12 risultano ripetizioni identiche.
- **Tema**: al primo import il tema del brano segue `prefers-color-scheme`; poi è per brano (`view.theme`). La libreria segue il tema di sistema.
- **Larghezza etichette**: il segmento ha `min-width` = lunghezza etichetta + 1 `ch`; un accordo sopra una parola corta sposta il testo di qualche carattere (accettato dal piano), mai sovrapposizioni (verificato a 360 px).
- **Area di tocco accordi**: l'etichetta è piccola; l'area attiva è estesa con uno pseudo-elemento (±9 px). I chip in intestazione e i pulsanti sono ≥ 44 px.
- **`accept` dell'input file**: `.mht,.mhtml,.html,message/rfc822,multipart/related` come da compito. Non verificato su iOS/Safari reale. Se il file risultasse non selezionabile, ripiego: togliere del tutto `accept`.
- **BPM mancante**: la UI mostra "BPM non trovato" e un campo (30–300) salvato nel brano. Il default di riproduzione (80) è per il round 2.
- **Storage**: `saveSong` aggiorna `updatedAt` e mette il brano in testa all'indice; le funzioni accettano uno storage iniettato come ultimo argomento.
- **Il file reale non è UTF-8 valido** (contiene parti binarie): `file.text()` sostituisce i byte non validi con U+FFFD senza effetti sul brano.

## Round 2 (implementatore)

- **A capo solo sugli spazi**: ogni parola del testo con i suoi segmenti-accordo è un `span.w` nowrap; un accordo sopra uno spazio si ancora al primo spazio esistente (nessun segnaposto); un accordo oltre la fine del testo è un gruppo a sé. Nelle righe strumentali gli accordi sono separati da uno spazio. Nuova funzione pura `buildLineGroups` in `segments.js`.
- **Linearità del parser**: le chiusure degli `<span>` di una riga si trovano in un solo passaggio con uno stack (`matchSpanEnds`). Uno span accordo con nome vuoto è ignorato (il suo testo resta testo) con un solo avviso per brano.
- **`source.url`** salvato senza `_gl`, `_ga`, `gclid`, `fbclid`, `utm_*`. Reimport: duplicato se stesso URL (se entrambi lo hanno), altrimenti stesso titolo+artista. "Sostituisci" tiene durate e BPM modificati solo se la sequenza di nomi accordi per sezione/riga è identica; altrimenti avvisa (`alert`) solo se c'erano modifiche.
- **Schema 2**: `section.bpm/bpmSource/strumIndex`; `view.beatsPerChord` (default 4). `migrateSong` da schema 1 applica la proposta di tempi. `validateSong` ora richiede `beats` intero ≥ 1. La proposta (`proposeSectionTempos`) usa il confronto senza maiuscole; la regola "onwards" parte dalla prima sezione col nome indicato. Un pattern senza BPM assegna il ritmo ma non il tempo.
- **BPM efficace**: propaga in avanti solo il BPM della sezione precedente; non c'è propagazione all'indietro. `song.bpm` mancante → 80.
- **"Applica a tutte le sezioni con lo stesso nome"** usa il nome identico (non il nome base), per non toccare Verse con tempi diversi. Nel riquadro unito "Chorus (×N)" il tempo mostrato è quello della prima sezione e la modifica vale per tutte quelle del gruppo.
- **Riproduzione**: ogni avvio (anche da pausa e da tocco su accordo) ha il conteggio di una battuta; il giro del loop no. La partenza dal loop da fermo ha il conteggio, poi il loop ripete senza. Il tocco su un accordo riparte da lì solo in riproduzione/pausa; da fermo apre ancora il foglio dell'accordo (aggancio per il round 3). Il tempo di visualizzazione compensa `outputLatency || baseLatency`.
- **Cambio di durate/BPM/velocità durante il play**: la posizione si conserva in battiti frazionari (`beatPositionAtTime`/`timeAtBeatPosition`), non in secondi.
- **Registrazione**: toccare entro mezzo battito dal tocco precedente, o arrotondare allo stesso battito, è un tocco doppio e si ignora (la spec dice "entro 1 battito", ma col jitter ±80 ms a 142 BPM un accordo di 1 battito sarebbe stato scartato). Gli accordi senza tocco tengono la durata attuale. L'ultimo accordo termina con il tocco successivo, con "Fine" o tiene la durata attuale. La registrazione si ferma da sola dopo tocchi pari al numero di accordi.
- **Modalità modifica**: le sezioni sono rese una per una (senza fondere i "×N" né comprimere), così ogni accordo è modificabile. Il controllo −/+ è nella barra in basso (al posto del pannello di riproduzione).
- **Tema**: pulsante con icona SVG sole/luna da 24 px e testo "Chiaro"/"Scuro".
- **Tap tempo** modifica il BPM della sezione corrente (o della prima se fermo), arrotondato all'intero tra 30 e 300.

## Round 3 (implementatore)

- **Wake Lock**: un flag `wakeWanted` + `wakePending`; se la richiesta si risolve dopo una pausa/stop il lock viene rilasciato subito. L'avviso "schermo potrebbe spegnersi" è una riga chiudibile nel pannello (`panel.showNotice`).
- **Pannello in play**: riga principale = accordo corrente (+ diagramma), prossimo, play/pausa; seconda riga = pallini, BPM, ritmo (le celle si restringono, mai a capo) e pulsante "⋯"; velocità / clic / tap tempo / stop stanno dietro "⋯". Durante il play la barra in alto non è più sticky (`.is-playing`), per dare spazio alle righe. Scorrimento: la riga corrente va al 25% dell'altezza sopra il pannello; si riapplica anche dopo pausa→play e dopo A+/A−.
- **Durate sospette** (≥ 2× o ≤ ½ della mediana): servono almeno 3 durate registrate, sotto non si segnala nulla.
- **Duplicati**: `findDuplicateSongs` (puro, `model.js`) elenca tutte le copie, la più recente per prima; con più copie il dialogo ha un pulsante "Sostituisci …" per copia (titolo + data di import).
- **Trasposizione**: ±12 semitoni; l'indicatore azzera. Ortografia dalla tonalità del risultato; Fa#/Solb maggiore sempre in diesis (F#). `usesFlats` considera anche la radice scritta: una tonalità data come `Gb` è "bemolle". Tonalità minori canoniche: C#m, Ebm, F#m, G#m, Bbm. `estimateKey` aggiunge a parità un piccolo vantaggio al maggiore e un bonus del 5% della durata totale per primo/ultimo accordo = tonica.
- **I nomi scritti sono accordi reali**: il capotasto cambia solo le forme mostrate (`view.showShapes`, nuovo campo, default false). Il capotasto letto da UG resta informativo: non viene interpretato come "gli accordi sono già forme" (il file reale ha capo 0). Scegliere un capo > 0 nel foglio attiva le forme, "Senza capotasto" le spegne; il checkbox le alterna.
- **Capotasto**: punteggio = difficoltà media pesata per battiti (più basso = meglio), a parità vince il capo minore. Difficoltà come da compito, più: slash comuni extra (A/C#, F/C, Em/D, D/A, G/D, Am/E…) = 3; altre qualità comuni su radici non aperte = 4; qualità rare, slash non in tabella, nomi non validi = 5; maj7 aperti C D A G E = 1,5. Il foglio mostra le 3 migliori, più l'opzione attuale e "Senza capotasto" se mancano. Etichette: ≤1,6 facile, ≤2,6 abbastanza facile, ≤3,6 medio, altrimenti difficile. Non c'è un selettore libero 0–7 (solo le opzioni suggerite).
- **Diagrammi**: frette assolute, `baseFret` = 1 se ci sono corde vuote o la forma parte dal tasto 1, altrimenti il tasto più basso premuto. `getChordShapes` dà le forme a mano e poi le barré generate (forma-Mi, forma-La); `getChordShape` la prima (ordinate per tasto più basso). `m7b5`, `dim7`, `dim`, `sus2` hanno solo la forma-La, `aug`, `m9` e `add9` non aperti non hanno forme (UI: "diagramma non disponibile"). Slash fuori tabella: forma dell'accordo base + `bass`, mostrato come "Basso: F#" nel foglio. Il test sulle note suonate copre tutte le forme di 12 radici × 16 qualità (non solo maggiori/minori).
- **Colori accordi** legati al nome scritto; `data-chord` = nome mostrato, `data-orig` = nome scritto.
- **Libreria**: l'indice ha in più `timingSource`, `bars` (battiti totali / battiti per battuta, arrotondato) e `openedAt`; le voci vecchie si completano da sole (`listLibrary`). Il badge è "durate ✓ · N battute". L'ordinamento scelto è salvato in `gapp.settings.v1` (`librarySort`).
- **Export/import**: gli id dei brani si conservano, per questo "già presente" = stesso `id` (non stesso URL/titolo come nell'import .mht). L'import scrive con `putSong` (mantiene `updatedAt`, quindi andata e ritorno identica) e ripristina i valori grezzi di tutte le chiavi toccate se una scrittura fallisce. Le impostazioni importate riempiono solo le chiavi mancanti. Il campo `audio` si esporta solo come metadati semplici (round 4). Su iOS (UA iPhone/iPad o Mac con touch) si prova prima `navigator.share({ files })` se disponibile, altrimenti `<a download>`: non verificabile in Chromium.
- **Spazio**: stima = 2 byte per carattere delle chiavi dell'app (indice, impostazioni, brani), mostrata in KB.
- **Moduli**: nuovo `libio.js` (puro, storage iniettato) e `ui/chordsheet.js`; `storage.js` importa `countBars` da `model.js`.

## Round 4 (implementatore)

- **Latenza per dispositivo**, non per brano: `gapp.device.v1` = `{ latencyMs }` (−100…+400, default 0). Sostituisce la scelta della spec (campo in `audio`). Il tempo mostrato è `audio.currentTime − latenza`; i clic del metronomo non usano la latenza (audio e clic passano dalla stessa uscita). Il valore stimato da `outputLatency` è solo proposto nella calibrazione, non applicato da solo.
- **Ancore**: `buildTimeline(song, { speed, anchors })` con tempi assoluti nell'audio; con audio `speed = 1` e la sezione 0 è ancorata all'offset (`audioAnchors`). Ancore non crescenti o per sezioni inesistenti sono ignorate con un warning in `timeline.warnings`. Se le sezioni tra due ancore, al loro BPM, supererebbero l'ancora successiva vengono compresse per finire lì (scelta mia: evita eventi non monotoni); se finiscono prima resta un vuoto.
- **Fine brano** (`audio.endSec`, facoltativo) chiude l'ultimo intervallo per il suggerimento BPM. Il suggerimento arrotonda a 0,1 BPM e confronta col BPM efficace pesato per battiti; "Applica" porta tutte le sezioni dell'intervallo allo stesso BPM (`bpmSource: 'edited'`).
- **Due player**: il metronomo (`createPlayer`) resta com'è e serve anche al registratore a tap (timeline senza ancore); `createAudioPlayer` (`src/audio.js`) è attivo quando il brano ha l'audio. L'`AudioContext` e il `MediaElementAudioSourceNode` si creano solo alla prima attivazione del clic (l'audio normale resta un `<audio>` semplice, evita problemi di iOS col tasto silenzioso). Il clic è spento di default con l'audio e si salva in `song.audio.metronome`.
- **Clic dopo seek/pausa/velocità**: i clic già programmati ma non ancora suonati vengono annullati (`osc.stop()`), poi il nucleo puro riparte dal primo battito ≥ posizione.
- **Velocità con audio**: solo `playbackRate` (timeline invariata). Con velocità < 100% la durata a muro cresce, i tempi nell'audio no.
- **Tocco su accordo**: con audio da fermo apre ancora il foglio dell'accordo; in play/pausa salta e suona senza conteggio.
- **Pause**: `{ name: 'N.C.', rest: true }`, "+ pausa" in modifica all'inizio di ogni sezione, "Elimina pausa" nella barra; il pannello mostra "—", l'etichetta è grigia tratteggiata "pausa".
- **Audio mancante / sostituzione**: stesso nome e dimensione → si conservano offset e ancore senza chiedere; diverso → `confirm` ("Tenere l'inizio e le ancore?"). Eliminando il brano (libreria o schermata) si elimina l'audio da IndexedDB. Libreria: badge "audio ✓", MB in IndexedDB e stima del browser.
- **Export JSON**: `stripAudio` ora conserva anche la mappa `anchors`; l'import normalizza `audio` (`normalizeAudio`).
- **Validazione import (correzioni round 3)**: `transpose` accettato −12…+12 (non −11…+11 come nel compito: l'interfaccia permette ±12 e un'esportazione normale verrebbe rifiutata), capo 0–12, beats 1–64, BPM 20–400, `timeSignature` numeratore 1–16 e denominatore 2/4/8/16.
- **Spazio in play su schermi bassi**: soglia `innerHeight < 700`; i diagrammi piccoli si riattivano da "⋯ → Diagrammi" (salvato in `view.panelDiagrams`); l'avviso schermo chiuso non torna per il brano (`view.wakeNoticeClosed`).
- **Numero del tasto** sotto i 48 px: "5fr" sotto il diagramma, cifre da 10 px.
- **"Sostituisci"**: etichetta con data e ora, poi "(copia N)" (`labelCopies`); `mergeIntoExisting` ora in `model.js` e conserva transpose, capo, showShapes e audio.
- **Selettore capotasto libero** 0–12 nel foglio. **Forme**: aug, add9 (barré E/A), m9 (solo forma E), più Dadd9 e Fadd9 aperti.
- **Test regressione round 3**: `test/regression/round3.todo.test.js` spostato in `test/round3-fixes.test.js` senza `todo`.

## Round 5 (implementatore)

- **Suggerimento BPM = un fattore unico.** Tra due ancore (o ultima ancora e "Fine brano") si confronta la durata misurata con quella prevista dai BPM salvati: `k = previsto / misurato`. "Applica" moltiplica il BPM di *ogni* sezione del tratto per `k` (arrotondato a 0,1): i rapporti tra le sezioni restano. Il testo dice la percentuale e il BPM in più/meno ("da +0,3 a +0,7 BPM circa" se le sezioni hanno tempi diversi). Il campo `suggested` resta il BPM medio pesato dopo la correzione, `current` quello prima; in più `factor`, `expected`, `seconds`.
- **Soglia sull'errore di tempo**, non sul BPM: suggerimento solo se `|misurato − previsto| > max(150 ms, 0,3% del tratto)`. Costanti `SYNC_ERR_MIN_SEC` e `SYNC_ERR_REL` in `src/audiosync.js` (sostituiscono `SYNC_BPM_TOLERANCE`).
- **Timeline tra ancore: scala uniforme, mai vuoti.** In ogni tratto tra due ancore consecutive tutte le sezioni sono scalate dello stesso fattore, sia che sforino sia che avanzino; dopo l'ultima ancora valgono i BPM salvati (la fine brano non ancora usata dalla timeline: serve solo al suggerimento). Ogni sezione della timeline ha `bpm` (effettivo), `savedBpm` e `scale`. Il pannello mostra "♩ ≈ x" quando l'effettivo differisce dal salvato di più di 0,2. Le sezioni dell'intestazione e il BPM nell'editor mostrano ancora il salvato.
- **Ancore ⚓ sempre visibili** se il brano ha metadati audio (anche con "audio mancante": sono dati salvati). Tocco sulla ⚓ (vista brano e schermata di sincronizzazione) → foglio dal basso con ±10/±50 ms e "Togli l'ancora" (l'offset della sezione 0 non si toglie). I pulsanti ±0,1 s delle righe sono stati sostituiti da questo foglio.
- **Libreria: "audio ✓" solo se il file c'è in IndexedDB.** La lista si disegna con un badge neutro "audio"; poi un controllo asincrono (`audioStoreHas`, risultato in cache per la vista) lo aggiorna a "audio ✓" o "audio mancante" (arancione).
- **"Primo accordo!"** fissa l'inizio del primo evento che non è pausa: `offset = tocco − startSec(primo accordo vero)`, con i BPM salvati e senza altre ancore (`firstChordOffsetSec`). Se il tocco cade prima della fine della pausa, messaggio "Troppo presto" invece di un offset negativo.
- **Schermata di sincronizzazione**: barra fissa in basso con "Primo accordo!" e "⚓ <sezione>" (≥ 56 px, due colonne), sotto −5 s / Play / +5 s / posizione / "⋯". Dietro "⋯": barra di scorrimento e "Ascolta dall'inizio (con il clic)". Su iPhone SE la barra occupa meno del 20% dell'altezza. Il messaggio è un foglio fisso sopra la barra (va a capo, sparisce dopo 5 s, 9 s se errore; il testo resta nel DOM). Il pulsante grande di "Primo accordo!" non sta più nel riquadro "2. Inizio".
- **Pannello di riproduzione**: "🔁 Sezione" (tocco = esci dal loop) e icona del clic 🔔/🔕 sempre visibili nella seconda riga.
- **Spaziatura del testo**: l'etichetta dell'accordo sta in un contenitore di larghezza zero (`.chw`) e sporge sopra il testo senza spostarlo. Il segmento si allarga solo se `col(successivo) − col(questo) < lunghezza etichetta + 1`, di quanto manca; i segmenti senza testo (righe strumentali, accordo oltre la fine) hanno `lunghezza + 1`. In modifica durate la lunghezza conta anche il numero di battiti (+2). Per evitare scroll orizzontale, `.screen { overflow-x: clip }`.
- **Messaggi dell'e2e del round 4**: `round4.cjs` S6 ora si aspetta *nessun* suggerimento per uno scarto di 0,12 s su 5 s (sotto soglia); la precisione è garantita dalle ancore.

## Limiti noti della v1

- Da provare su telefono vero: Wake Lock, leggibilità all'aperto, intonazione al 75% (`preservesPitch`) su Safari, clic e audio con cuffie Bluetooth (il clic non compensa la latenza: audio e clic escono dalla stessa uscita, ma va confermato a orecchio), file `.mht` da Safari/Chrome Android.
- Caug e C#aug/Dbaug hanno solo forme da 5 dita (musicalmente giuste, poco suonabili).
- Il registratore a tap non suona l'audio: con un brano che ha l'audio si registra "a vuoto" (le durate si correggono con −/+).
- Il clic sopra l'audio non compensa la latenza dell'uscita (vale solo se audio e clic escono insieme).
- "Fine brano" serve solo al suggerimento BPM: dopo l'ultima ancora la timeline usa i BPM salvati.
- Con un'etichetta lunga all'estremo destro di una riga, vicino a una parola di una lettera, l'etichetta può sporgere nel margine della sezione (non crea scroll).
