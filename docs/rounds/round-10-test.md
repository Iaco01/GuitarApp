# Round 10 — Tester: tic per quarto, ritocco rapido, sezioni tolte nel reale

Leggi `CLAUDE.md`, `docs/rounds/round-10-impl.md` (anche le "Aggiunte dell'utente" A e B), `docs/reports/round-10-impl.md`, `docs/reports/round-9-test.md` (i tuoi bug 1–7) e `docs/DECISIONS.md` (sezione "Round 10").

Regole come sempre:
- non toccare `src/`, `scripts/` né i test esistenti;
- i tuoi file vanno in `test/e2e/round10-tester-*` e in `test/regression/` (con `todo`);
- screenshot in `test-artifacts/round-10/`, e vanno guardati;
- **nessun testo del brano** nei file committati;
- niente push.

Le due aggiunte A e B sono **richieste dirette dell'utente**: verificale come le userebbe lui, sul telefono, con l'mp3 reale sincronizzato.

## A. Metronomo con la sincronizzazione (aggiunta A, priorità)
1. Mp3 reale sincronizzato, intercetta gli oscillatori del metronomo per tutto il brano, o almeno per 3 sezioni stabili e 1 a tempo libero. Per ogni accordo misura:
   - il numero di tic e la durata audio in quarti al BPM misurato;
   - la spaziatura dei tic;
   - l'accento sul primo tempo della battuta.

   Conta gli accordi con più tic dei loro quarti, i tic più vicini di 0,6 × il battito e i tic doppi ai confini degli accordi.
2. Sintetico con durate note (accordi da 1, 2, 3, 4 e 8 quarti): per ogni accordo il numero di tic deve essere esatto e l'errore di tempo dei tic < 30 ms.
3. Tempo libero: cosa si sente? Descrivilo e misura la spaziatura.
4. La riga del ritmo, il contatore dei battiti, il loop e il conto alla rovescia sono coerenti con i tic.
5. Dopo un ritocco (B) e dopo "Correggi a orecchio" i tic seguono i nuovi tempi.
6. Senza allineamento: tutto come prima (durate stimate) e un brano salvato con schema 2 riceve le stime.

## B. Ritocco rapido (aggiunta B)
1. Su SE e 13:
   - pressione lunga su un accordo nel foglio;
   - poi ±0,25 / ±0,05;
   - poi "Solo questo accordo" e "Questo e i seguenti";
   - infine "Ascolta da qui".

   Misura i tempi salvati, l'evidenziazione in play e i tic.
2. Sezione: dal pulsante ⇄ nell'intestazione e dalla riga nella schermata di sincronizzazione. È facile da trovare? Chi non conosce l'app lo scopre senza istruzioni? Annota.
3. Limiti:
   - 20 tocchi di −0,25 sullo stesso accordo: non scavalca il precedente e la durata resta ≥ 0,1 s;
   - lo stesso sul primo e sull'ultimo accordo del brano;
   - lo stesso accanto a un gap e accanto a una sezione saltata.
4. "Annulla" più volte di fila, reload, export/import della libreria.
5. Conflitti tra:
   - ritocco e "Correggi a orecchio" sulla stessa sezione;
   - ritocco e "Sposta tutto";
   - ritocco e ancore manuali;
   - ritocco e una nuova sincronizzazione automatica: chiede conferma prima di perdere i ritocchi?
6. La pressione lunga su un accordo non deve rompere lo scorrimento del foglio col dito, né la pressione lunga per il loop sull'intestazione. Prova i gesti con `hasTouch`.

## C. Correzioni dei bug del round 9
1. Reale con sezioni tolte: almeno 4 sezioni diverse, due tolte insieme e una tolta più una ripetuta. Cerca verdi sbagliati. Quando le strofe sono identiche negli accordi, l'app segna "non presente" una strofa diversa da quella tolta: che effetto ha per l'utente (testo evidenziato sbagliato)? Valuta la gravità.
2. Reale tagliato al 20, 30, 45 e 70%, con un taglio a inizio brano (primi 60 s tolti) e con entrambi.
3. Assolo al posto di una sezione (semi nuovi), anche sul reale: inserisci 20 s di un'altra parte del brano trasposta.
4. Tempo libero: il tuo banco del round 9, con rosso < 50%, giallo ≥ 75% e mai verde.
5. Il reale intero non deve cambiare rispetto al round 9 (328 eventi): confronta.

## D. Testi e interfaccia
- Le righe con il motivo a 320, 360, SE e 13: niente troncamenti; altezza delle righe; screenshot.
- "Correggi a orecchio":
  - partenza da un accordo qualsiasi;
  - stop a metà;
  - salvataggio parziale;
  - barra fissa con 35 accordi.
- Gap in play: il foglio scorre alla sezione che riprende, senza BPM "≈".
- Una sezione saltata: niente loop e l'avviso compare.

## E. Regressione e prova da utente
1. `npm test`, `test/e2e/round10-regress.sh` e i tuoi e2e del round 9.
2. CPU ×4 (3 corse): tempo totale e frame più lungo. Nessun peggioramento oltre il 10% rispetto al round 9.
3. Prova da utente su SE e 13 con l'mp3 reale:
   - importa e sincronizza;
   - ascolta i tic in una sezione stabile;
   - trova un accordo che "arriva tardi" e ritoccalo;
   - sposta una sezione intera;
   - suona da metà.

   Annota ogni esitazione.

## Report: `docs/reports/round-10-test.md`
Formato dei round precedenti, bug numerati con gravità. Risposta finale di 15 righe al massimo.
