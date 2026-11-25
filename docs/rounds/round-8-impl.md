# Round 8 — Implementatore: robustezza della sincronizzazione automatica

Leggi `CLAUDE.md`, `docs/reports/round-7-test.md` (bug numerati), `docs/reports/round-7-impl.md`, `docs/DECISIONS.md` (sezione "Round 7"), il codice in `src/analysis/`, `src/alignment.js`, `src/ui/autosync.js`, `src/ui/correct.js`, `src/ui/syncscreen.js`, `src/ui/playpanel.js`, e i test di regressione del tester in `test/regression/round7-tester.test.js` (i 3 `todo` devono diventare test normali che passano; poi rimuovi la cartella se resta vuota).

## 1. Media — Audio più lungo del foglio: nessun allineamento (bug 1)

Con musica in più (ripetizioni non scritte nel foglio, audio 1,25× o 2×) il motore restituisce `null`. Le registrazioni reali spesso hanno intro, assoli o ritornelli in più rispetto al foglio UG, quindi è un caso comune.

- Aggiungi all'allineamento stati **"musica non nel foglio"** con un'emissione neutra e un costo per frame moderato. Vanno all'inizio, alla fine e **tra una sezione e l'altra**.
- Permetti anche di **ripetere una sezione** già vista: dopo la fine di una sezione si può tornare all'inizio della stessa sezione, con un costo. Gli eventi ripetuti non hanno un posto nel modello del brano, quindi nel risultato quel tratto è "musica non nel foglio" e la UI lo segnala ("0:42–1:10: parte non presente nel foglio").
- Test: i casi del tester (1,25× e 2×) producono un allineamento con gli eventi del foglio entro 250 ms nelle parti stabili; il sintetico normale non peggiora.

## 2. Media — Confidenza troppo alta nei tratti a tempo libero sbagliati (bug 2)

La confidenza deve misurare quanto il punto scelto è **migliore delle alternative vicine**, non solo quanto l'accordo somiglia al modello.

- Per ogni cambio, confronta il punteggio del percorso con quello dei percorsi che spostano quel cambio di ±0,25 / ±0,5 / ±1 s. Conta la margine: picco netto = alta, piatto = bassa.
- La confidenza di sezione è la mediana di quelle dei suoi cambi.
- Nei tratti senza battito stabile il colore massimo è giallo, mai verde.
- Taratura: sul banco sintetico, rosso se < 50% dei cambi entro 250 ms, verde se ≥ 90%. Riporta la tabella confidenza → accuratezza vera sul sintetico (tuo e del tester).

## 3. Media-bassa — BPM − / + con allineamento attivo è ingannevole (bug 3)

Con un allineamento attivo i tempi vengono dall'audio, quindi il BPM non deve cambiarli. Nel pannello − / + restano visibili ma disattivati, con la nota "Con la sincronizzazione automatica il tempo segue l'audio: per correggere una sezione usa «Correggi a orecchio»". Senza allineamento (o dopo "Rimuovi sincronizzazione") funzionano come prima.

## 4. Bassa — Rumore: proposta di trasposizione e "pronta" (bug 4)

- Proponi la trasposizione solo se il margine sulla seconda migliore supera una soglia tarata sui casi reali e sintetici (es. ≥ 10% del punteggio).
- Se quasi tutte le sezioni sono rosse, il risultato è "Audio non riconosciuto: è il brano giusto?", senza "pronta".

## 5. Bassa — "Correggi a orecchio" (bug 5)

- Stile `:disabled` chiaro per tutti i pulsanti dell'app.
- Durante la correzione mostra sempre l'accordo atteso al prossimo tocco e quanti ne mancano.
- "Annulla ultimo tocco".
- Se alla fine mancano tocchi, l'anteprima indica quali accordi sono senza tempo; si può salvare lo stesso e quelli mancanti tengono il tempo automatico.

## 6. Bassa — Prestazioni (bug 6)

Con CPU ×4 l'analisi dura 17,7–18,5 s. Obiettivo: < 14 s, misurato con lo stesso script del tester, frame più lungo < 200 ms.
- Cerca i punti caldi con un profilo in Node.
- Se serve, sposta l'analisi in un Web Worker creato da un Blob con il codice dei moduli di `src/analysis`: deve funzionare nel file unico della build. Documenta come.

## 7. Bassa — Il pannello cresce di 20 px al Play a 360 px (bug 7)

Il pannello deve avere la stessa altezza da fermo e in play.

## 8. Cosmetico — Schermata di sincronizzazione (bug 8)

- Riepilogo compatto: una riga per sezione.
- "Fatto" in una barra fissa.
- Le notifiche non coprono le righe: vanno sopra la barra fissa.

## Consegna

- Commit piccoli, `npm test` verde, niente push, messaggi come sempre.
- Rilancia gli e2e dei round 6–7 (compresi `test/e2e/round7-tester-*` del tester) e riporta l'esito.
- `docs/reports/round-8-impl.md` con:
  - i numeri: tabella confidenza/accuratezza, tempi con CPU ×4, casi audio lungo;
  - le decisioni, riportate anche in `docs/DECISIONS.md`;
  - una risposta finale di 15 righe al massimo.
