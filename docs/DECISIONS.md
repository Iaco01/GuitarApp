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
