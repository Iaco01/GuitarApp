# Round 7 — Tester: sincronizzazione automatica e correzioni del round 6

Leggi `CLAUDE.md`, `docs/rounds/round-7-impl.md`, `docs/reports/round-7-impl.md` (fasi A, B0, B), `docs/DECISIONS.md` (sezione "Round 7"). Regole come sempre: non toccare `src/`, `scripts/` né i test esistenti; i tuoi file vanno in `test/e2e/` e `test/regression/` (con `todo`); screenshot in `test-artifacts/round-7/`, guardati davvero; **nessun testo del brano** nei file committati; niente push.

## A. Correzioni del round 6
1. La riga del ritmo è leggibile (celle ≥ 14 px) e la cella corrente è accesa in ogni frame (campiona tu). Altezza del pannello su 360 / SE / 13.
2. Limite BPM: fattore limitato, avviso, Annulla anche senza audio.
3. Primi accordi di sezione ≥ 2 battiti sul file reale; la levare è esclusa.
4. Pulsanti −/+ ≥ 44 px, "♩=62".

## B. Motore (Node, indipendente)
1. Il tuo generatore sintetico (diverso da quello dell'implementatore, riusa `test/e2e/round4-tester-make.mjs` e arricchiscilo con accordi pizzicati veri, basso, batteria, una sezione a tempo libero, una trasposizione e una sintonia diversa): percentuale di cambi entro 100/250/500 ms. Confronta con i numeri della Fase A.
2. Robustezza:
   - audio più corto o più lungo del foglio (sezioni mancanti o ripetute in più);
   - accordo mancante;
   - silenzio iniziale lungo (10 s);
   - mono a 22 kHz;
   - rumore puro.
   Niente crash, confidenze basse dove serve, messaggi sensati.
3. Determinismo: due esecuzioni danno risultati identici.

## C. App (Playwright, mp3 reale e sintetico)
1. Flusso completo: carica audio → "Sincronizza automaticamente" → barra di avanzamento → "Annulla" a metà (la pagina non resta bloccata; dopo l'annullamento si può rifare) → riepilogo per sezione con colori → "Accetta".
2. Tempo con CPU ×4 sull'mp3 reale; la pagina resta reattiva durante il calcolo (misura il frame più lungo).
3. Play con allineamento: sulla traccia sintetica l'evidenziazione segue i tempi veri (errore per evento, medio e massimo), anche nella sezione a tempo libero.
4. "Correggi a orecchio" con tocchi simulati in ritardo di +80 ms e con un tocco saltato: cosa succede? Anteprima, salvataggio, sezione verificata.
5. Esportazione delle correzioni: il JSON contiene solo tempi e nomi di accordi; `autosync-real.mjs --truth` lo legge e calcola l'errore.
6. Interazioni: le ancore manuali prevalgono nella loro sezione; il BPM −/+ con allineamento attivo fa qualcosa di sensato (descrivilo); la trasposizione proposta si applica.
7. Persistenza dopo reload; export/import della libreria con allineamento.

## D. Regressione e prova da utente
Tutti gli e2e dei round 4–7. Poi la prova da utente su iPhone SE e iPhone 13: dal brano importato all'mp3 sincronizzato in automatico e corretto in una sezione. Annota dove ti blocchi.

## Report: `docs/reports/round-7-test.md`
Formato dei round precedenti. Risposta finale di 15 righe al massimo.
