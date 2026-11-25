# Round 9 — Implementatore: verdi affidabili, tempo libero, gap in play

Leggi `CLAUDE.md`, `docs/reports/round-8-test.md` (bug 1–10), `docs/reports/round-8-impl.md`, `docs/DECISIONS.md` (sezione "Round 8"), il codice in `src/analysis/`, `src/alignment.js`, `src/timeline.js`, `src/ui/autosync.js`, `src/ui/syncscreen.js`, `src/ui/playpanel.js` e `src/ui/correct.js`. Poi leggi gli script del tester `test/e2e/round8-tester-*` e `test/regression/round8-tester.test.js`: i 3 `todo` devono diventare test normali in `test/` che passano, e la cartella va rimossa se resta vuota.

Priorità: un **verde sbagliato** è il difetto peggiore, perché l'utente non lo controlla.

## 1. Media — Audio più corto del foglio: verde sbagliato (bug 1)
- Il foglio può finire prima dell'audio: le sezioni finali (e, con un costo più alto, una sezione intera nel mezzo) possono essere **saltate**. Una sezione saltata non ha tempi; nel riepilogo compare "Verse 5: non presente nell'audio"; in play la timeline la salta.
- **Controllo di coerenza del tempo**, che vale per tutti i casi:
  - in una sezione a tempo stabile, il BPM implicito dai cambi scelti deve restare vicino al BPM stimato della sezione;
  - i cambi compressi o stirati oltre una soglia (es. ±15%) abbassano la confidenza dell'evento e della sezione: non può essere verde.
- Test: script del tester `round8-tester-cut.mjs` (tagli 50–90%, 5 semi), con 0 sezioni verdi con più del 10% dei cambi sbagliati di oltre 250 ms; il sintetico normale non peggiora.

## 2. Media — Tempo libero: precisione e confidenza (bug 7)
Il punto debole sono le sezioni a tempo libero con arpeggio: il cambio di accordo diventa visibile nel croma solo dopo qualche nota.
- **Raffinamento del cambio** nelle sezioni a tempo libero (e, se aiuta, anche nelle stabili):
  - cerca in una finestra [−1,0 s, +0,3 s] attorno al cambio scelto;
  - prendi il primo attacco forte (flusso spettrale) in cui il **basso** (croma del basso) passa alla fondamentale del nuovo accordo;
  - se non c'è, prendi l'attacco più forte compatibile.
- **Confidenza per accordo di due stimatori**: il confine dal croma e il confine raffinato. Se coincidono entro 150 ms, la confidenza è alta; se divergono, è bassa.
- Il tempo libero resta "mai verde", ma il giallo deve significare qualcosa:
  - tarare in modo che il giallo libero sia ≥ 75% entro 250 ms su **ogni** banco;
  - il rosso libero < 50%;
  - la correlazione di rango tra confidenza ed errore nel tempo libero deve essere positiva e chiara.
- Rubato troppo prudente: le sezioni a rubato giuste dovrebbero uscire gialle con confidenza alta.
- Riporta, sul banco del tester (`round8-tester-confidence` o equivalente) e sul tuo:
  - la tabella prima/dopo: entro 250 ms per colore;
  - la correlazione di rango;
  - le sezioni con arpeggio giuste per sezione.

## 3. Bassa — Intro estranea: il primo accordo parte 3 s prima (bug 3)
Il primo evento del foglio deve avere una confidenza calcolata anche sul suo **inizio**, che oggi è 1,00 per costruzione. Il gap iniziale deve poter assorbire l'intro. Test `todo` del tester: il primo evento entro 0,5 s.

## 4. Bassa — Gap in play (bug 2, 9) e gap corti sul reale
- Durante un gap ≥ 3 s:
  - nessun accordo evidenziato;
  - il pannello mostra "Fuori dal foglio" e "Riprende tra N s con «C»" (conto alla rovescia in secondi);
  - la barra dell'accordo non resta piena.
- Sul reale compaiono 8 gap di 1,8–4,2 s, tutti al confine tra Chorus e Verse. Probabilmente sono battute di passaggio non scritte nel foglio, non errori.
  - Un gap < 3 s si fonde con l'accordo precedente, che dura di più, e non mostra "fuori dal foglio".
  - Un gap ≥ 3 s resta un gap.
  - Riporta i gap che restano sul reale.
- Una sezione accanto a un gap non perde il suo BPM, né lo stato "sicura", se i suoi cambi sono stabili (bug 9).

## 5. Bassa — Rumore: "Usa comunque" (bug 5)
- Quando il risultato è "Audio non riconosciuto" ma un allineamento c'è, offri "Usa comunque": salva l'allineamento con tutte le sezioni al massimo gialle.
- Rivedi la soglia: il brano giusto con SNR −10 dB bianco o −5 dB rosa deve essere riconosciuto se l'allineamento è coerente. Il controllo di coerenza del punto 1 può aiutare a distinguere un brano vero da uno casuale.

## 6. Bassa — Tap tempo e campo numerico con allineamento (bug 6)
Con un allineamento attivo, il tap tempo e il campo numerico con «Applica» devono essere disattivati come − e +, con la stessa nota.

## 7. Bassa — Prestazioni e memoria (bug 8)
- Margine: con CPU ×4, totale < 12 s, frame più lungo < 150 ms in 3 corse su 3, "Annulla" < 0,4 s (il tester misura 0,7 s).
- Memoria:
  - dopo il mix mono e il ricampionamento al rate di analisi, rilascia i buffer decodificati originali;
  - scrivi le feature in `Float32Array` e non tenere copie;
  - obiettivo: picco del processo almeno −30% rispetto ai +413 MB misurati dal tester; usa il suo metodo (somma degli RSS dei processi di Chromium).

## 8. Cosmetico — Testi (bug 4, 10)
- Schermata di sincronizzazione a 320 e 360 px: niente troncamenti, e il BPM è sempre visibile. Usa testi più corti ("da controllare" → "controlla", "tempo libero" → "libero") o metti lo stato su una seconda riga.
- Correzione a orecchio:
  - con 35 accordi il pulsante «Cambio!» non copre le istruzioni;
  - nell'anteprima, singolare e plurale: "manca 1 tocco" / "mancano N tocchi".

## Consegna
- Commit piccoli, `npm test` verde, niente push, messaggi come sempre.
- Rilancia tutti gli e2e dei round 7–8 (anche quelli del tester) e riporta l'esito.
- `docs/reports/round-9-impl.md` con:
  - le tabelle prima/dopo: tagli, intro, confidenza del tempo libero, prestazioni e memoria;
  - i gap sul reale;
  - le decisioni, riportate anche in `docs/DECISIONS.md`;
  - una risposta finale di 15 righe al massimo.
