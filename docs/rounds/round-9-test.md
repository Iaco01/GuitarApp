# Round 9 — Tester: verdi affidabili, tempo libero, gap, decodifica a pezzi

Leggi `CLAUDE.md`, `docs/rounds/round-9-impl.md`, `docs/reports/round-9-impl.md`, `docs/reports/round-8-test.md` (i tuoi bug 1–10) e `docs/DECISIONS.md` (sezione "Round 9").

Regole come sempre:
- non toccare `src/`, `scripts/` né i test esistenti;
- i tuoi file vanno in `test/e2e/round9-tester-*` e in `test/regression/` (con `todo`);
- screenshot in `test-artifacts/round-9/`, e vanno guardati davvero;
- **nessun testo del brano** nei file committati;
- niente push.

Verifica **indipendente e scettica**: misura prima di leggere i numeri del report.

## A. Il brano reale non deve essere rifiutato (priorità)
Il report dice che il reale ha `match` 0,122 contro una soglia di 0,12: è troppo vicino. Produci con ffmpeg varianti dell'mp3 reale, da tenere solo in `test-artifacts/`:
- 64 kbps;
- 320 kbps;
- mono 22 kHz;
- volume −12 dB;
- primi 10 s tagliati;
- 5 s di silenzio iniziale;
- equalizzazione "telefono" (passa-banda 300–3400 Hz);
- riverbero (`aecho`);
- rumore rosa a 10 dB e a 0 dB;
- velocità ×1,03 senza cambio di intonazione (`atempo`);
- intonazione +1 semitono;
- m4a/AAC;
- ogg;
- wav.

Per ognuna riporta:
- riconosciuto sì/no;
- `match`;
- colori delle sezioni (verdi, gialle, rosse);
- numero di gap e sezioni saltate;
- tempo di analisi.

Un rifiuto del brano giusto in un caso realistico è **bloccante**. Dimmi anche se riconosciuto, rossi e `match` sono combinati in AND o in OR, e se la regola ha senso.

## B. Correzioni del round 8 (bug 1, 3, 7)
1. Tagli: rifai `round8-tester-cut.mjs` con **semi nuovi** e tagli 40–95%. Cerca verdi sbagliati e sezioni saltate a torto, cioè presenti nell'audio ma marcate "non presente nell'audio".
2. Sezioni mancanti nel mezzo dell'audio:
   - 1 sezione mancante;
   - 2 sezioni mancanti;
   - una sezione mancante sostituita da un assolo.

   Il salto e il gap si distinguono?
3. Intro estranea di 5, 15 e 30 s, e intro con gli stessi accordi del Verse: misura l'errore sul primo evento.
4. Tempo libero, banco tuo nuovo:
   - arpeggio con prima nota in comune con l'accordo precedente;
   - rubato;
   - accordi tenuti a lungo;
   - voce sola con accordi rari.

   Riporta la quota entro 250 ms per colore e la correlazione di rango. Il giallo libero deve essere ≥ 75%, il rosso < 50%, e mai verde.

## C. Gap e sezioni saltate in play (bug 2, 9)
- Durante un gap ≥ 3 s:
  - nessuna evidenziazione;
  - "Fuori dal foglio";
  - il conto alla rovescia è giusto (errore < 0,5 s).
- Dopo il gap l'evidenziazione riparte a tempo.
- I gap < 3 s sono fusi con l'accordo precedente.
- Le sezioni saltate:
  - il play passa oltre;
  - toccare una sezione saltata non rompe nulla;
  - in "Correggi a orecchio" su una sezione saltata succede qualcosa di sensato.
- Seek, pausa e ripresa dentro un gap.
- Persistenza dopo reload ed export/import della libreria con gap e salti.

## D. Decodifica MP3 a pezzi (nuova, rischiosa)
1. Confronta i campioni decodificati a pezzi con la decodifica intera (stesso file): differenza massima, durata totale, sfasamento ai confini dei pezzi (< 1 ms) e clic ai confini.
2. File difficili:
   - VBR;
   - tag ID3v2 grande (copertina di 500 KB);
   - ID3v1 in coda;
   - mono;
   - 44,1 e 48 kHz;
   - un mp3 con header Xing/LAME;
   - un mp3 troncato a metà frame;
   - un file che non è mp3 ma ha estensione .mp3.

   Niente crash, durata giusta, allineamento uguale alla decodifica intera.
3. Sincronizzazione del play: dopo la decodifica a pezzi la posizione audio e l'evidenziazione restano allineate per tutto il brano (misura a 1, 4 e 8 minuti).

## E. UI e prestazioni (bug 4, 5, 6, 8, 10)
1. "Usa comunque":
   - rumore → forzato → tutte le sezioni al massimo gialle;
   - si può rimuovere.
2. Tap tempo e campo numerico bloccati con l'allineamento, attivi senza.
3. Testi a 320 / 360 / SE / 13: niente troncamenti, BPM visibile (screenshot).
4. Correzione con 35 accordi; singolare e plurale.
5. CPU ×4, 3 corse:
   - totale;
   - frame più lungo;
   - frame > 100 ms;
   - "Annulla";
   - picco RSS.
6. CPU ×6: misura informativa.

## F. Regressione e prova da utente
1. `npm test`, tutti gli e2e dei round 4–9 (anche i tuoi).
2. Prova da utente su SE e 13 con l'mp3 reale:
   - importa;
   - sincronizza;
   - leggi il riepilogo;
   - correggi una sezione rossa;
   - suona attraverso il gap a 0:59–1:03.

   Annota cosa non è chiaro nei testi.

## Report: `docs/reports/round-9-test.md`
Formato dei round precedenti, bug numerati con gravità. Risposta finale di 15 righe al massimo.
