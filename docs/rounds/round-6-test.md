# Round 6 — Tester: durate stimate e BPM dal pannello

Leggi `CLAUDE.md`, `docs/rounds/round-6-impl.md`, `docs/reports/round-6-impl.md` e `docs/DECISIONS.md` (sezione "Round 6"). Regole come ai round precedenti. Verifica **indipendente e scettica**.

## A. Durate stimate
1. Scrivi tu un contatore di sillabe semplice e indipendente, e confronta la tabella del report (prima strofa e primo ritornello): le sillabe assegnate a ogni accordo coincidono con le tue? Riporta le differenze.
2. Proprietà sul file reale:
   - totale di ogni sezione multiplo di 4;
   - nessuna durata < 1;
   - media per sezione tra 3 e 5;
   - ritornelli identici con durate identiche;
   - monotonia (più sillabe → durata ≥, salvo ±2).
   Conta le violazioni.
3. Giudizio musicale: guarda i casi estremi del brano (le durate più corte e più lunghe) e dì se sono plausibili per come sono posizionati gli accordi sul testo. Il report segnala che il primo accordo di una sezione con attacco anticipato può uscire corto (es. G 3 / D 1): quanti casi così ci sono?
4. Migrazione: un brano salvato con schema 2 e `timingSource: 'default'` riceve la stima; uno `edited` resta intatto.
5. Impostazione "Durate: stimate / fisse 2/4/8": conferma prima di sovrascrivere le durate modificate.

## B. BPM dal pannello
1. − / + durante il play, senza audio: l'evento corrente e la frazione del battito restano invariati al momento del cambio (misura a ogni frame con `window.__gapp`); i cambi successivi arrivano col nuovo tempo (errore < 20 ms); nessun clic doppio (intercetta gli oscillatori).
2. "Tutto il brano" scala in proporzione (verifica i rapporti tra sezioni dopo 10 passi + e 10 passi −: tornano esattamente ai valori iniziali?); "Solo questa sezione" cambia solo quella.
3. Pressione prolungata: ripete a ~5/s (Chromium con `page.mouse.down` e anche con eventi touch: `hasTouch: true`, `page.touchscreen` o `dispatchEvent` di `touchstart`/`touchend`).
4. Con l'audio: l'audio non salta, l'evidenziazione si sposta, "Annulla" ripristina esattamente.
5. Persistenza dopo reload; altezza del pannello invariata (360 px, SE, iPhone 13). Il ritmo ridotto a 19 px a 360 px: è ancora leggibile? Guarda lo screenshot.

## C. Regressione
`npm test`, `test/e2e/round5.cjs`, `test/e2e/round4.cjs`, i tuoi script dei round 4–5 su precisione audio e ancore.

## Report: `docs/reports/round-6-test.md`
Formato dei round precedenti. Risposta finale di 15 righe al massimo.
