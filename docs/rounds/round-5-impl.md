# Round 5 — Implementatore: rifinitura e correzioni finali

Ultimo round prima della v1. Leggi `CLAUDE.md`, `docs/DECISIONS.md`, `docs/reports/round-4-impl.md` e soprattutto `docs/reports/round-4-test.md` (bug, tabella delle milestone, "Prova da utente"). Nessuna funzione nuova: solo correzioni e chiarezza. Ogni correzione con un test (Node dove possibile, e2e altrimenti).

## 1. GRAVE — Il suggerimento BPM appiattisce i tempi delle sezioni (bug 1 del tester)

Oggi "Applica" su un suggerimento che copre più sezioni imposta **lo stesso BPM** su tutte: sul file reale, "Fine brano" + "Applica" trasforma 62/96/142 in 108,5 ovunque.

Regola corretta: la misura tra due ancore dice solo che *quel tratto* dura `t2 − t1` secondi invece di `previsto`. La correzione è un **fattore unico** `k = previsto / (t2 − t1)` applicato **in proporzione** a tutte le sezioni del tratto: `bpm_i ← round1(bpm_i × k)` (arrotondato a 0,1). I rapporti tra le sezioni restano invariati. Il testo del suggerimento diventa: "Tra Verse 2 e Chorus 4 l'audio va il 0,6% più veloce: +0,8 BPM circa su ogni sezione. Applica".
- Test sul file reale: offset + "Fine brano" con una durata vera simulata dello 0,5% più corta → dopo "Applica" i BPM sono 62,3 / 96,5 / 142,7 (o valori proporzionali equivalenti) e l'errore previsto a fine brano è < 50 ms.
- Il test `todo` del tester in `test/regression/round4.todo.test.js` per questo bug deve passare senza `todo` (spostalo nella suite normale).

## 2. MEDIO — Suggerimento che scatta per il ritardo del tocco (bug 2)

La soglia non va sul BPM ma sull'**errore di tempo**: suggerisci solo se `|t2 − t1 − previsto| > max(150 ms, 0,3% del tratto)`. Un ritardo di 78 ms del tocco non deve produrre suggerimenti. Test `todo` → test normale.

## 3. Ancore e tratti: niente vuoti, niente compressioni a metà (bug 4)

Sostituisci "comprimi se sfora / lascia un vuoto se avanza" con una regola unica: **dentro ogni tratto tra due ancore consecutive le sezioni si scalano uniformemente** (stesso fattore `k` del punto 1, solo nella timeline, senza modificare i BPM salvati) in modo da riempire esattamente il tratto. Dopo l'ultima ancora si usano i BPM salvati. Così l'evidenziazione non si ferma mai e non c'è salto all'ancora. Il pannello mostra il BPM *effettivo* (scalato) con una piccola indicazione "≈" quando differisce da quello salvato di più di 0,2. "Applica" (punto 1) rende permanente quella scala. Test `todo` → test normale, più un test che passa da un tratto all'altro senza salti dell'evento corrente.

## 4. Ancore visibili (bug 3)

Le ⚓ con il tempo (es. "⚓ 1:42,3") devono comparire nell'intestazione delle sezioni ancorate, nella vista brano e nella schermata di sincronizzazione, subito dopo averle fissate e dopo un reload. Tocco sulla ⚓ → regolazione fine ±10/±50 ms o rimozione.

## 5. "audio ✓" in libreria quando il file manca (bug 5)

La libreria deve controllare IndexedDB: "audio ✓" solo se il file c'è, altrimenti "audio mancante" (in arancione). Il controllo è asincrono e non deve rallentare la lista: prima si mostra la lista, poi si aggiornano i badge.

## 6. Pausa iniziale e "Primo accordo!" (bug 6)

"Primo accordo!" fissa l'istante del **primo evento non di pausa**: `offsetSec = tap − startSecRelativo(primoAccordoVero)`. Se il brano inizia con una pausa, il testo del pulsante resta "Primo accordo!" e il risultato non deve spostarsi di 4 battiti. Test.

## 7. Prova da utente (sezione D del report)

- Nella schermata di sincronizzazione il pulsante "Primo accordo!" e il pulsante delle ancore stanno **sempre** nella barra fissa in basso, grandi (≥ 56 px di altezza), visibili appena parte la musica, senza dover scorrere.
- La barra fissa su iPhone SE non deve superare il 20% dell'altezza: compatta i controlli secondari dietro "⋯" come nel pannello del player.
- I messaggi di conferma non devono essere tagliati su iPhone SE (375×667): vanno a capo o usano un foglio dal basso.
- Indicatori a schermo nel pannello: "🔁 Chorus" quando il loop è attivo (tocco = esci), icona del clic accesa/spenta visibile senza aprire "⋯".
- Rileggi la sezione D del report e correggi gli altri punti di confusione segnalati, se semplici; quelli che non fai, elencali nel report con il motivo.

## 8. Spaziatura del testo sotto gli accordi (segnalato dal coordinatore)

Oggi ogni segmento accordo ha `min-width = lunghezza etichetta + 1ch` (`renderLine` in `src/render.js`) e così il testo prende spazi che non c'erano (sul file reale a scala 1,0 si vedono doppi e tripli spazi tra parole in diverse righe della prima strofa, ad esempio dopo una parola di una sola lettera con un accordo sopra). Lo spazio extra serve **solo** quando l'etichetta toccherebbe quella dell'accordo successivo **sulla stessa riga**. Regola: il segmento si allarga solo se `col(successivo) − col(questo) < lunghezza etichetta + 1`, e solo della quantità che manca. In tutti gli altri casi l'etichetta sporge sopra il testo che segue (overflow visibile) senza spostarlo.
- Test e2e sul file reale a 360 px, scala 1,0 e 2,0: 0 etichette sovrapposte (come prima), e il numero di righe in cui il testo reso ha più spazi consecutivi dell'originale deve essere 0 tranne dove serve a evitare una sovrapposizione. Riporta quanti casi restano e perché.
- Attenzione alla riga a capo: un'etichetta che sporge oltre il bordo destro del contenitore non deve creare scroll orizzontale.

## 9. Pulizia finale

- `README.md`: aggiorna con tutte le funzioni, come si fa la build, come si fanno girare `npm test` e gli script e2e principali, e una sezione "Usarla sul telefono" provvisoria (il coordinatore la completerà con l'hosting scelto).
- `docs/DECISIONS.md`: sezione "Round 5" con le scelte di questo round, e una sezione "Limiti noti della v1" (cosa resta da provare su telefono vero, Caug a 5 dita, registratore a tap senza audio, clic senza compensazione della latenza).
- Nessun file di debug o script morto lasciato nel repository.

## Consegna

Come i round precedenti: commit piccoli con test verdi, niente push, verifica Playwright con screenshot guardati (iPhone SE e iPhone 13: sincronizzazione, pannello con loop, spaziatura del testo prima/dopo), `docs/reports/round-5-impl.md`, risposta finale di 10–15 righe.
