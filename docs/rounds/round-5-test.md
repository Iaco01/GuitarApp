# Round 5 — Tester: verifica delle correzioni finali e verdetto v1

Leggi `CLAUDE.md`, `docs/rounds/round-5-impl.md`, `docs/reports/round-5-impl.md`, `docs/DECISIONS.md` (sezioni "Round 5" e "Limiti noti della v1") e il tuo report `docs/reports/round-4-test.md`. Regole come ai round precedenti.

## A. Bug del round 4 (ripeti le tue misure del round 4, con i tuoi script)
1. Bug 1 (grave): sul file reale, offset + "Fine brano" con durata simulata −0,5% → "Applica" mantiene i rapporti tra le sezioni; errore a fine brano. Ripeti anche sulla tua traccia sintetica con +1 BPM su una sola sezione: con ancore a ogni sezione, l'errore torna < 100 ms ovunque?
2. Bug 2: tocco in ritardo di 78 ms → nessun suggerimento. Trova tu la soglia minima che fa comparire un suggerimento e dì se è sensata.
3. Bug 4: con tratti più lunghi e più corti del previsto, nessun vuoto e nessun salto dell'evento corrente al passaggio di un'ancora (misura con `window.__gapp` a ogni frame).
4. Bug 3, 5, 6: ⚓ visibili dopo sync e reload; badge audio corretto con file presente/assente; "Primo accordo!" con pausa iniziale.
5. Precisione M6 sulla tua traccia, al 100% e al 75%: errore medio e massimo (prima: max 20 ms). Non deve essere peggiorata.

## B. Interfaccia
1. Spaziatura del testo sotto gli accordi sul file reale (360 px, SE, 13; scala 1,0 e 2,0): righe con spazi in più rispetto al testo originale, etichette sovrapposte, scroll orizzontale. L'implementatore dichiara 4 etichette "Em" tagliate di ~5 px al bordo a scala 2,0: verifica e giudica quanto disturba.
2. Barra fissa della sincronizzazione: altezza su SE 375×667 e 320×568; pulsanti ≥ 56 px raggiungibili appena parte la musica.
3. Indicatori 🔁 e 🔔/🔕 nel pannello.
4. Ripeti la "Prova da utente" (sezione D del round 4) su iPhone SE e iPhone 13 e confronta: cosa è migliorato, cosa blocca ancora.

## C. Regressione e verdetto
1. `npm test`, tutti gli script e2e dei round 1–5.
2. Aggiorna la tabella delle milestone M1–M6 del round 4 con l'esito finale.
3. **Verdetto**: la v1 è pronta per la prova sul telefono vero? Sì/No, con l'elenco breve di cosa l'utente deve provare a mano (che non si può verificare qui).

## Report: `docs/reports/round-5-test.md`
Formato dei round precedenti. Risposta finale di 15 righe al massimo.
