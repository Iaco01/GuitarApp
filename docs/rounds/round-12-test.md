# Round 12 — Tester: seek esatto, confine tra accordi uguali, regolazione e diagnostica

Leggi `CLAUDE.md`, `docs/rounds/round-12-impl.md` (comprese le aggiunte dell'utente), `docs/reports/round-12-impl.md`, `docs/reports/round-11-test.md` e `docs/DECISIONS.md` (sezione "Round 12").

Regole come sempre:
- non toccare `src/`, `scripts/` né i test esistenti;
- i tuoi file vanno in `test/e2e/round12-tester-*` e in `test/regression/` (con `todo`);
- screenshot in `test-artifacts/round-12/`;
- **nessun testo del brano** nei file committati;
- niente push.

Dopo questo round l'utente riprova sul telefono (Android + Firefox): il round è **breve e mirato** a ciò che sentirà lui.

## A. Seek esatto (priorità)
1. Sul reale, in Chromium, salta in tutti i modi dell'app:
   - play da una sezione;
   - tocco su un accordo durante il play;
   - "Ascolta da qui";
   - loop (3 giri);
   - pausa e ripresa;
   - velocità all'80%;
   - seek dalla barra.

   Ogni volta misura lo scarto evidenziazione → attacco vero, con il tuo metodo, nei 10 s dopo il salto. Riporta la mediana e il massimo per tipo di salto e per posizione (30, 63, 150, 300, 450 s).
2. Clic doppi o mancanti dopo i salti, silenzio al giro del loop, tempo di ricarica del blob, memoria dopo 30 salti (RSS e URL revocati).
3. File che non sono mp3 (m4a, ogg, wav): il seek normale funziona ancora.
4. Verifica l'affermazione dell'implementatore: il seek con `el.currentTime` sbagliava di 0,6–1,7 s anche in Chromium. I tuoi test dei round 9–11 non l'avevano visto: perché?

## B. Primo G del Chorus 1 (segnalazione dell'utente)
- L'evento 35 sta a ~63,4 s e dura < 1,5 s:
  - sul reale;
  - con le tue varianti di decodifica (diverse da quelle dell'implementatore);
  - e nell'app.
- Cerca casi in cui il confine fra due accordi uguali consecutivi scivola nella coda: nel reale e in un sintetico tuo con un accordo tenuto 5 s, che si spegne, seguito dallo stesso accordo che riattacca.

## C. Regolazione e diagnostica
- La regolazione ±50 ms da −1000 a +1000:
  - l'effetto si vede subito sull'evidenziazione e sui tic;
  - si salva per dispositivo;
  - "Ascolta e regola" funziona.
- "Informazioni tecniche": il JSON non contiene testo del brano (cerca le parole del foglio). Contiene i campi chiesti e la deriva misurata.

## D. Bug del round 11 e regressione
- Verifica i bug 1, 2, 3/4, 5, 7 e 10, segnati come risolti.
- `npm test` e `round10-regress.sh`. Distingui i FAIL vecchi da quelli nuovi.
- Prova da utente su un profilo Android in Chromium (per esempio Pixel 7):
  - importa, sincronizza;
  - suona dal Verse 1 al Chorus 1;
  - salta a metà;
  - regola di +100 ms;
  - esporta la diagnostica.

## Report: `docs/reports/round-12-test.md`
Formato dei round precedenti, bug numerati con gravità, e una sezione **"Cosa deve controllare l'utente sul telefono"** di 5 righe al massimo. Risposta finale di 15 righe al massimo.
