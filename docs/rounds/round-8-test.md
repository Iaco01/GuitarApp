# Round 8 — Tester: robustezza della sincronizzazione automatica

Leggi `CLAUDE.md`, `docs/rounds/round-8-impl.md`, `docs/reports/round-8-impl.md`, `docs/reports/round-7-test.md` (i tuoi bug 1–8) e `docs/DECISIONS.md` (sezione "Round 8").

Regole come sempre:
- non toccare `src/`, `scripts/` né i test esistenti;
- i tuoi file vanno in `test/e2e/round8-tester-*` e, per i bug ancora aperti, in `test/regression/` (con `todo`);
- screenshot in `test-artifacts/round-8/`, e vanno guardati davvero;
- **nessun testo del brano** nei file committati;
- niente push.

Verifica **indipendente e scettica**: non riusare i casi dell'implementatore come unica prova.

## A. Audio con musica non nel foglio (bug 1)
1. Costruisci casi nuovi con il tuo generatore (`round7-tester-make.mjs`) e con semi diversi da quelli del report:
   - intro strumentale di 15 s con accordi non del foglio;
   - assolo di 20 s tra due sezioni su una progressione diversa;
   - ritornello finale ripetuto 2 volte;
   - sezione centrale ripetuta;
   - audio più corto (foglio intero, audio tagliato al 70%);
   - fine sfumata.

   Per ogni caso riporta tre cose:
   - eventi del foglio entro 100/250/500 ms nelle parti stabili;
   - gap trovati rispetto ai gap veri (inizio/fine, errore);
   - colori delle sezioni.
2. Un gap messo dove non c'è musica in più (falso positivo) sul sintetico normale e sull'mp3 reale? Conta i gap che compaiono sul reale e dove.
3. Nell'app: la riga "parte non presente nel foglio" compare e ha i tempi giusti; durante il play nel gap cosa vede l'utente (descrivi, screenshot)?

## B. Confidenza (bug 2)
1. Su un banco tuo, senza guardare i numeri del report prima di aver misurato:
   - almeno 40 sezioni;
   - comprese sezioni a tempo libero con arpeggio, rubato e cambi rapidi;
   - comprese sezioni stabili ma difficili: accordi che condividono note, rumore alto, accordi di 1 battito.

   Costruisci la tabella stato/colore → quota entro 250 ms.
2. Requisiti: verde ≥ 90% entro 250 ms, rosso < 50%, tempo libero mai verde. Cerca di proposito un **verde sbagliato**: è il caso peggiore per l'utente.
3. Le confidenze degli eventi vanno da 0 a 1 e sono monotone rispetto all'errore (correlazione di rango)?

## C. Rumore, trasposizione, BPM (bug 3, 4)
1. Rumore, silenzio, un altro brano sintetico con accordi diversi, il brano giusto con forte rumore (SNR 5 dB):
   - messaggio;
   - niente salvataggio dove serve;
   - trasposizione proposta sì/no.

   Il brano giusto con tanto rumore non deve finire "non riconosciuto" se è ancora allineabile: dove sta il confine?
2. Brano trasposto di +2 e −5 semitoni: la proposta compare e si applica.
3. BPM − / + con allineamento:
   - disattivati, con la nota;
   - attivi di nuovo dopo "Rimuovi sincronizzazione";
   - con ancore manuali e senza allineamento, come prima.

## D. Correzione a orecchio e UI (bug 5, 7, 8)
1. "Correggi a orecchio" con queste prove:
   - prossimo accordo e conteggio corretti a ogni tocco;
   - "Annulla ultimo tocco", ripetuto fino a zero;
   - tocchi mancanti → anteprima con l'elenco, salvataggio parziale, gli accordi mancanti tengono il tempo automatico (verifica i tempi);
   - tocchi in più oltre la fine.
2. Stile `:disabled` visibile su tutti i pulsanti dell'app (screenshot).
3. Altezza del pannello da fermo e in play a 360 / SE / 13, con e senza audio, con e senza riga del ritmo.
4. Schermata di sincronizzazione:
   - righe compatte;
   - barra fissa con "Fatto" sempre visibile mentre scorri;
   - le notifiche non coprono nulla;
   - testo non troncato a 320 px.

## E. Prestazioni (bug 6)
1. CPU ×4 sull'mp3 reale, 3 corse:
   - tempo totale;
   - frame più lungo;
   - numero di frame > 100 ms e > 250 ms;
   - tempo di risposta di "Annulla".
2. CPU ×6 come prova di carico (solo informativo).
3. Memoria: picco dello heap JS durante l'analisi (CDP `Performance.getMetrics` o `performance.memory`).

## F. Regressione e prova da utente
1. `npm test`, tutti gli e2e dei round 4–8 (i tuoi compresi). Per i tuoi e2e del round 7 che ora falliscono (C4a, C3c), dì se il nuovo comportamento è giusto e aggiornali in un file nuovo, non modificando il vecchio.
2. Prova da utente su iPhone SE e iPhone 13 con l'mp3 reale:
   - importa;
   - sincronizza;
   - leggi il riepilogo;
   - correggi la sezione più gialla;
   - suona da metà brano.

   Annota dove ti blocchi e cosa non capisci dai testi della UI.

## Report: `docs/reports/round-8-test.md`
Formato dei round precedenti, bug numerati con gravità. Risposta finale di 15 righe al massimo.
