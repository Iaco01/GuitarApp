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
