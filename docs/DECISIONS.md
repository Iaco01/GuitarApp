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
