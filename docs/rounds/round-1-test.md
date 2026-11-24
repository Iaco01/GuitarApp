# Round 1 — Tester: parser e visualizzazione (M1 + M2)

Leggi `CLAUDE.md`, `docs/SPEC.md` (milestone 1 e 2), `docs/IMPLEMENTATION_PLAN.md` e `docs/reports/round-1-impl.md`. Il tuo compito è **verificare in modo indipendente**, non fidarti del report dell'implementatore.

## Regole

- **Non modificare `src/`, `scripts/` né i test esistenti.** Puoi aggiungere test end-to-end in `test/e2e/` (file `.cjs` con `require('playwright')`, eseguibili con `node test/e2e/<file>.cjs`) e, se trovi un bug nel parser, un test `node --test` che lo riproduce in `test/regression/` marcato `todo` (`test('…', { todo: 'bug #N' }, …)`), così la suite resta verde.
- Screenshot in `test-artifacts/round-1/` (ignorato da git). Guardali con lo strumento Read: un controllo visivo che non hai guardato non conta.
- Mai copiare testo del brano reale nel report o nei test committati.
- Commit dei soli file in `test/e2e/`, `test/regression/` e del report, con messaggi in inglese. Non fare push.

## Cosa verificare

### A. Automatico
1. `npm test`: tutti verdi? Quanti test, quanti skip? Il test sul file reale gira davvero (non skip)?
2. `npm run build`: riesce? Dimensione di `dist/index.html`? Il file contiene richieste di rete (`http://`, `https://` in `src=`/`href=`/`fetch(`)? Non deve.
3. Rileggi le asserzioni dei test sul file reale e confrontale con i criteri M1 della spec e del piano: manca qualcosa? Sono asserzioni vere o deboli (es. `>= 1` dove serve `=== 328`)?

### B. Parser, controlli indipendenti
Scrivi uno script tuo (nello scratch o in `test/e2e/`) che importa `src/parser.js` e confronta col file reale, calcolando tu i valori in modo indipendente (es. contando gli span nel `<pre>` con una regex separata):
- 328 accordi, distinti `G D Em Am C A` in ordine; 12 sezioni nell'ordine giusto; titolo "American Pie", artista "Don McLean", Beginner, "E A D G B E", capo 0; 3 ritmi 62/96/142 con 16/8/8 celle; 22 `mark: "*"`.
- Nessun residuo della pubblicità (cerca `bidding`, `primis`, `<`, `>`, `&nbsp;` nei testi e nei nomi accordi).
- Le colonne `col`: per 10 righe a campione, ricostruisci la riga accordi originale dal `<pre>` e verifica che `col` corrisponda alla posizione reale.
- Varianti sintetiche: binary, quoted-printable, base64, senza span, senza ritmo. Prova anche casi brutti fatti da te: file vuoto, file .txt casuale, MHT troncato a metà, HTML senza `<pre>`. L'app non deve andare in crash: deve dare un errore leggibile.

### C. Interfaccia sul telefono (Playwright, `dist/index.html`)
Esegui con almeno due emulazioni: `devices['Pixel 7']` e `devices['iPhone 13']`, più una larghezza di 360 px.
1. Libreria vuota: istruzioni visibili e comprensibili.
2. Import del file reale con `setInputFiles`: il brano si apre, intestazione corretta.
3. **Nessuno scroll orizzontale**: `document.documentElement.scrollWidth <= window.innerWidth`.
4. **Allineamento accordi**: per ogni etichetta accordo con testo sotto, verifica col layout (getBoundingClientRect) che il bordo sinistro dell'etichetta coincida (±2 px) con il bordo sinistro del carattere di testo su cui cade. Fallo anche con font al massimo (A+ fino al limite), dove le righe vanno a capo. Riporta il numero di accordi controllati e quanti fuori tolleranza.
5. **Nessuna sovrapposizione** tra etichette accordo (rettangoli che si intersecano).
6. A−/A+ e tema chiaro/scuro: funzionano, restano dopo un reload, sono per brano.
7. Ripetizioni comprimibili: si comprimono e si espandono, il conteggio torna.
8. Tocco su un accordo: si apre il foglio; si chiude.
9. Persistenza: reload della pagina → il brano è ancora in libreria. Eliminazione con conferma.
10. Tasto indietro (history.back) dal brano torna alla libreria.
11. Leggibilità: guarda gli screenshot e giudica come musicista che legge da un leggio a 60 cm. Contrasto, dimensione del testo, colori degli accordi distinguibili.
12. Console: nessun errore JS durante tutti i passi.

## Report: `docs/reports/round-1-test.md`

- Tabella con ogni punto (A1…C12): **PASSA / FALLISCE / NON VERIFICABILE**, con una riga di evidenza (numeri, nome screenshot).
- Elenco bug numerati: gravità (bloccante / importante / minore), passi per riprodurre, atteso vs ottenuto, file e riga sospetti se li hai individuati.
- Cosa non hai potuto verificare (es. Safari reale, telefono fisico) e perché.
- Risposta finale: stesso contenuto in 15 righe al massimo.
