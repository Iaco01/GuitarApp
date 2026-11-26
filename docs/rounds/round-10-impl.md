# Round 10 — Implementatore: sezioni tolte o sostituite nel reale, testi più chiari

Leggi `CLAUDE.md`, `docs/reports/round-9-test.md` (bug 1–7 e "Cosa non è chiaro nei testi"), `docs/reports/round-9-impl.md`, `docs/DECISIONS.md` (sezione "Round 9") e gli script del tester `test/e2e/round9-tester-*`. In `test/regression/round9-tester.test.js` ci sono 3 `todo`: devono diventare test normali in `test/` che passano. I test sul reale si saltano se manca la fixture locale. Poi rimuovi la cartella se resta vuota.

Priorità, come sempre: **nessun verde sbagliato**.

## 1. Media — Reale con una sezione di mezzo tolta: verde sbagliato (bug 1)
Il controllo di coerenza del tempo è spento sul reale perché le durate del foglio sono stime dal testo. Serve un controllo che **non dipenda dalle durate del foglio**:
- **Coerenza tra sezioni uguali.** Le sezioni con la stessa sequenza di accordi (ad esempio i Chorus) devono avere durate in battiti simili, misurate con i battiti trovati dal motore. Se una sezione si scosta molto dalla mediana delle sue sorelle, abbassa la confidenza: non può essere verde.
- **Coerenza col battito.** Nelle sezioni a tempo stabile i cambi devono cadere vicino ai battiti e le durate devono essere numeri interi di battiti plausibili.
- Trova la causa del salto mancato sul reale, partendo dal caso del tester (Verse tolta, per esempio la 5). Il salto di una sezione intera deve funzionare anche sul reale. Indica nel report cosa lo impediva.
- Test: il `todo` del tester (sezione tolta dal reale: nessun verde con più del 10% sbagliato e sezione marcata "non presente"). Prova almeno 3 sezioni diverse tolte dal reale e il caso con due sezioni tolte. Il reale intero non deve peggiorare: confronta i tempi evento per evento con il round 9; le differenze oltre 250 ms vanno elencate e motivate.

## 2. Media — Reale tagliato al 40–60% (bug 2)
- Quando l'audio finisce prima del foglio, le sezioni finali vanno saltate ("non presente nell'audio"), non lasciate rosse.
- Il riconoscimento si calcola **solo sulle sezioni non saltate**.
- Test: il `todo` del tester; tagli al 30, 40, 50, 60, 80 e 95% del reale.

## 3. Bassa — Sezione sostituita da un assolo (bug 3)
Il motore deve poter fare **salto + gap**: la sezione è marcata "non presente" e l'assolo diventa un solo gap continuo. Test: il `todo` del tester.

## 4. Bassa — Interfaccia (bug 4, 5)
- Su una sezione saltata il loop non si accende; mostra l'avviso "Questa sezione non è nell'audio".
- "Correggi a orecchio" con 35 accordi: "Anteprima" e "Salva" sempre visibili, in una barra fissa come nella schermata di sincronizzazione, su SE e su 13.
- Correzione lunga:
  - si deve poter partire da un accordo qualsiasi (tocca l'accordo da cui partire) e fermarsi quando si vuole;
  - si salva quello che c'è;
  - scrivi chiaramente "Puoi fermarti quando vuoi: i tocchi fatti vengono salvati".

## 5. Bassa — Tempo libero, rosso troppo pessimista (bug 6)
Ritara le soglie del tempo libero sul banco del tester (`round9-tester-engine.mjs`) e sul tuo. Obiettivi:
- rosso < 50% entro 250 ms;
- giallo ≥ 75%;
- mai verde.

Riporta la tabella prima/dopo.

## 6. Cosmetico — Testi (bug 7 e F2 del tester)
- Gli stati usano parole intere e uguali dappertutto (righe, legenda, conteggi): "sicura", "da controllare", "incerta", "tempo libero". Se a 320 px non stanno su una riga, mettile su due righe, senza troncarle.
- Per una sezione rossa o gialla spiega il motivo in una riga, ad esempio "tempo libero: i cambi sono stimati" o "tempi poco netti".
- Gap:
  - sotto i 6 s scrivi "passaggio non scritto nel foglio (4 s)", e da 6 s in su "parte non presente nel foglio";
  - aggiungi cosa fare ("nessuna azione richiesta").
- Durante un gap in play:
  - il foglio scorre all'inizio della sezione che riprende;
  - il pannello non mostra "≈153,7" BPM.

## Consegna
- Commit piccoli, `npm test` verde, niente push, messaggi come sempre.
- Rilancia gli e2e dei round 7–9, compresi quelli del tester, ad esempio `test/e2e/round9-regress.sh` se c'è.
- `docs/reports/round-10-impl.md` con:
  - tabelle prima/dopo per le sezioni tolte e i tagli del reale;
  - la differenza evento per evento sul reale intero;
  - il tempo libero;
  - le decisioni, riportate anche in `docs/DECISIONS.md`;
  - una risposta finale di 15 righe al massimo.

## Aggiunte dell'utente (durante il round)

### A. Metronomo: un tic per quarto anche con la sincronizzazione (prioritario)
Con un allineamento attivo ogni accordo fa sempre i suoi battiti del foglio (spesso 4), compressi o allargati sulla durata audio. Deve invece esserci un tic per ogni quarto reale: un accordo di 2 quarti fa 2 tic. Dettagli nel messaggio del coordinatore. Usa `alignment.eventBeats` e il BPM misurato. Nelle sezioni a tempo libero usa il tempo delle sezioni vicine.

### B. Correzione fine: spostare un accordo o una sezione un po' avanti o indietro
Oggi si corregge solo con "Correggi a orecchio", che chiede tutti i tocchi. Serve un ritocco rapido:
- **Pressione lunga su un accordo** (con l'allineamento attivo) apre un foglio piccolo con:
  - il nome e il tempo;
  - i pulsanti −0,25 / −0,05 / +0,05 / +0,25 s;
  - "Ascolta da qui", che parte 2 s prima e si ferma 2 s dopo;
  - la scelta di cosa spostare: "Solo questo accordo" (fra i due vicini, con un margine minimo) oppure "Questo e i seguenti della sezione".
- **Sulla riga di una sezione** (schermata di sincronizzazione) e sulla sua intestazione nel foglio: gli stessi pulsanti spostano l'intera sezione.
- Ogni ritocco:
  - si vede subito: evidenziazione e tic seguono il nuovo tempo;
  - ha "Annulla";
  - si salva nell'allineamento;
  - marca la sezione come "ritoccata a mano", con lo stesso peso di "verificata".
- Le funzioni pure stanno in `src/alignment.js`, con i loro test: mai un ordine dei tempi invertito, nessun accordo più corto di 0,1 s.
- e2e su SE: sposta un accordo di +0,25 e una sezione di −0,05, controlla i tempi, l'evidenziazione in play, l'annullamento e il reload.
