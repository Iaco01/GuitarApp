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
