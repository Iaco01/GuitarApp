# Report round 3 (implementatore)

## Fatto
- **Correzioni dal round 2** (tutte): (1) Wake Lock rilasciato se la richiesta si risolve dopo pausa/stop, test spostato in `test/player-wakelock.test.js` (cartella `test/regression/` rimossa); (2) avviso schermo nel pannello, chiudibile; (3) "Sostituisci" con più copie: elenco con titolo e data, si sceglie quale; (4) durate sospette nell'anteprima di registrazione ("forse hai saltato un tocco qui"); (5) riga corrente al 25% dell'altezza sopra il pannello; (6) pannello compatto con "⋯".
- **Trasposizione** (`transpose.js`, puro): `transposeChord`, `estimateKey` (G maggiore sul file reale), `transposedKey`, `usesFlats`, `displayChordName`. Pulsanti −/+, indicatore "Originale"/"+2" che azzera, salvato in `song.transpose`; testo, diagrammi, pannello, registratore usano il nome mostrato, i colori restano legati al nome scritto.
- **Capotasto**: `chordDifficulty`, `suggestCapo`, foglio "Capotasto" con le 3 migliori (+ attuale), vista "forme" (`view.showShapes`), intestazione "Capo 2 — forme".
- **Diagrammi**: `chords-db.js` (forme a mano + barré forma-Mi/forma-La per 12 qualità), `diagram.js` (SVG con `currentColor`), fila nell'intestazione (scorre dentro la fila), foglio dell'accordo con forme alternative e "Basso: F#", diagrammi piccoli di corrente e prossimo nel pannello.
- **Libreria**: ricerca senza accenti, 5 ordinamenti, badge "durate ✓ · N battute", esporta/importa JSON con anteprima, tre modalità per i già presenti, validazione prima di scrivere e rollback, stima dello spazio.

## Verifiche
- `npm test`: **127 test, 127 ok**, 0 saltati (erano 98). `npm run build` ok: **dist/index.html 171.073 byte (167,1 KB)**, 23 moduli (erano 121.227).
- Trasposizione: andata e ritorno e ottava su oltre 1500 accordi × ±12 × diesis/bemolle; sul file reale ±1…±12 torna all'originale (test e Playwright, 328 nomi). Capotasto sul file reale: transpose 0 → capo 0, transpose +2 → capo 2 con forme G D Em Am C A.
- Diagrammi: per 12 radici × 16 qualità ogni forma ha 6 valori validi, nessun tasto oltre baseFret+4, nessuna corda vuota con baseFret > 1, **tutte le note suonate sono note dell'accordo** (tabella di intervalli indipendente nel test), fondamentale presente, barré coerenti; per gli slash in tabella il basso è la nota più bassa. I 6 accordi del file reale hanno un diagramma in tutte le trasposizioni ±12 con diesis e bemolle.
- Playwright (`test/e2e/round3.cjs`, `round3-panel.cjs`, Pixel 7 a 360 px, file reale): tutti i controlli PASS. Screenshot guardati in `test-artifacts/round-3/` (non versionati): diagrammi in tema chiaro e scuro, foglio accordo, trasposto +2, foglio capotasto, vista forme, pannello con diagrammi e con "⋯" aperto, libreria con ricerca, dialogo di import (nuovi / già presenti), errore di import. Export con `page.waitForEvent('download')`, import in un contesto pulito: 4 brani byte per byte identici; secondo import: "0 nuovi, 4 già presenti"; JSON rotto: messaggio leggibile, libreria intatta.
- **Pannello in play, 360 px: 105 px** (95 senza diagrammi), obiettivo ≤ 120 raggiunto. Righe intere visibili in play (3 posizioni diverse, righe a capo contate una): 360×780 a 1,0: 12–13, a 1,5: **5–6**; iPhone 13 a 1,0: 10, a 1,5: **4–5**.

## Non verificato / limiti
- **iPhone 13 a scala 1,5: almeno 5 righe intere non è garantito** (4 in due posizioni su tre): dipende da quante righe vanno a capo. Ho tolto sticky alla barra in alto durante il play, ridotto interlinea e pannello; ulteriori guadagni richiederebbero di nascondere altro.
- Nessuna prova su telefono reale: `navigator.share` su iOS, scaricamento in Safari, aspetto dei diagrammi a 30 px (il numero del tasto nel pannello non è leggibile: lì i diagrammi sono solo indicativi, il numero si legge a 64 px e nel foglio).
- Il capotasto letto da UG (>0) non è interpretato come forme già applicate (file reale: 0). Nessun selettore libero del capo 0–7, solo le opzioni suggerite.
- Barré generati: la forma scelta come prima è quella col tasto più basso, non sempre la più comoda (es. G ha 320003 poi 320033, poi barré al 3°).
- Nessun test automatico dei fogli UI oltre allo script e2e; l'ordinamento "ultimo aperto" usa `openedAt`, assente nei brani mai aperti da questa versione (ripiego su `updatedAt`).

## Decisioni
Vedi `docs/DECISIONS.md`, sezione "Round 3".
