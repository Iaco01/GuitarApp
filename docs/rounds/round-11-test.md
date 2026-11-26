# Round 11 — Tester: tic sulla griglia, ritocco, fine del Verse 1

Leggi `CLAUDE.md`, `docs/rounds/round-11-impl.md` (compresa l'aggiunta sulla fine del Verse 1), `docs/reports/round-11-impl.md`, `docs/reports/round-10-test.md` (i tuoi bug 1–18) e `docs/DECISIONS.md` (sezione "Round 11").

Regole come sempre:
- non toccare `src/`, `scripts/` né i test esistenti;
- i tuoi file vanno in `test/e2e/round11-tester-*` e in `test/regression/` (con `todo`);
- screenshot in `test-artifacts/round-11/`;
- **nessun testo del brano** nei file committati;
- niente push.

## A. Tic (richiesta dell'utente)
1. Rifai il tuo `round10-tester-clicks` sul reale intero: intervalli tra i tic, conteggio per accordo, accenti, tic nel loop, ultimo tic.
2. **Fase dei tic sui battiti veri del reale**: trova un metodo indipendente. Per esempio:
   - picchi del flusso spettrale nelle bande basse (cassa) e alte (rullante);
   - autocorrelazione locale.

   Misura lo scarto mediano e il p90 tra tic e battito nelle sezioni stabili.
3. Lo spostamento globale di −25 ms dell'implementatore: è giusto sul tuo sintetico e sul reale, oppure peggiora qualcosa?
4. Tempo libero: come suona adesso (tic sui cambi più tic intermedi)? Descrivilo e misura.

## B. Fine del Verse 1 (segnalazione dell'utente)
1. Sul reale verifica in modo indipendente gli eventi 28–40:
   - con il tuo metodo, non quello dell'implementatore;
   - riporta per ognuno lo scarto dall'attacco o dal cambio che senti nel croma e nel basso;
   - controlla che nell'app non ci sia più "Fuori dal foglio" tra Verse 1 e Chorus 1.
2. La stessa correzione ha spostato altri eventi. Il coordinatore ha controllato l'evento 306 (D, Verse 6): ora è a 7:53,15, mentre nell'audio il G dura fino a ~7:53,8 e il D (basso F#/D) arriva a ~7:54,0–7:54,4. È una **regressione di ~0,8 s** (prima era 7:53,80).
   - Confronta tutti i 328 eventi tra il round 10 e il round 11.
   - Per ogni evento spostato di più di 0,25 s, verifica in modo indipendente se il round 11 migliora o peggiora.
   - Riporta il conteggio dei miglioramenti e dei peggioramenti.
3. Gap veri:
   - sintetico con assolo di 20 s, ripetizioni, intro estranea: i gap si trovano ancora?
   - un assolo "tenuto" su un solo accordo uguale all'ultimo del foglio: cosa succede?

## C. Ritocco
Ripeti il tuo `round10-tester-nudge` su SE, 13 e 320. Verifica in particolare:
- pulsante ⇄ dopo la sincronizzazione e dopo il reload;
- pressione lunga con tremolio di 5–10 px;
- il rilascio non preme nulla;
- i tic dopo il ritocco;
- il gap che si accorcia;
- le ancore che si spostano;
- il suggerimento mostrato una volta sola.

## D. Tagli e regressione
1. Tagli del reale (inizio, 20/45/70%) e sintetici: verdi sbagliati, sezioni "tagliate".
2. `npm test`, `test/e2e/round10-regress.sh` **completo** (l'implementatore non l'ha rilanciato) e i tuoi e2e del round 10.
3. CPU ×4: frame più lungo. L'implementatore misura 123–146 ms, il round 10 92–120: da dove viene la differenza?
4. Prova da utente su SE e 13 con l'mp3 reale:
   - sincronizza;
   - suona il Verse 1 fino al Chorus 1 con i tic;
   - ritocca un accordo;
   - suona da metà.

## Report: `docs/reports/round-11-test.md`
Formato dei round precedenti, bug numerati con gravità. Risposta finale di 15 righe al massimo.
