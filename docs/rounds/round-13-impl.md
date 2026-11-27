# Round 13 — Implementatore: grafica e usabilità (richieste dell'utente)

Leggi `CLAUDE.md`, `docs/DECISIONS.md` (sezioni "Round 10"–"Round 12") e il codice in `src/ui/songview.js`, `src/ui/playpanel.js`, `src/ui/chordsheet.js`, `src/render.js`, `src/audio.js` e lo stile in `src/` (CSS della build).

L'utente ha provato il round 12 sul telefono (Android, Firefox): "la sincronizzazione va molto bene, adesso è molto meglio". Ora chiede tre cose di grafica e usabilità, che sono la priorità di questo round. Il motore non si tocca.

## 1. Diagrammi degli accordi di lato, sempre visibili
Oggi la riga dei diagrammi sta in cima al brano e sparisce scorrendo. L'utente li vuole **di lato, visibili per tutta la canzone anche quando scorre**.
- Una **colonna fissa sul lato destro** (`position: sticky` o fissa nell'area del brano), sotto l'intestazione e sopra la barra in basso, con un diagramma per ogni accordo del brano (dopo trasposizione e capo), nell'ordine di prima comparsa.
- Su telefono in verticale (360–430 px) la colonna è stretta, 64–72 px:
  - diagrammi piccoli ma leggibili, con il nome sotto;
  - se gli accordi non stanno in altezza, la colonna scorre da sola;
  - il testo del brano occupa il resto della larghezza e va a capo come oggi, senza scorrimento orizzontale.
- In orizzontale e su schermi larghi la colonna è più larga, con diagrammi più grandi.
- **In play**: il diagramma dell'accordo corrente è evidenziato con lo stesso colore dell'evidenziazione nel testo, il prossimo è segnato in modo più tenue. La colonna scorre da sola per tenere visibile l'accordo corrente.
- Toccando un diagramma si apre il foglio dell'accordo, come oggi.
- **Impostazione** "Diagrammi: di lato / in cima / nascosti", salvata. Il valore predefinito è "di lato".
- Controlla le altezze e le larghezze a 320, 360, SE, 13 e 13 orizzontale, e prendi gli screenshot.

## 2. Barra in basso che si abbassa da sola
- Dopo **4 s senza tocchi sulla barra**, in play e da fermo, la barra si riduce a una **mini-barra** di 44–52 px che contiene:
  - Play/Pausa;
  - il nome dell'accordo corrente e del prossimo;
  - la posizione nel tempo;
  - una maniglia ▲.
- Toccando la mini-barra o la maniglia la barra si riapre; resta aperta finché la si usa e si richiude 4 s dopo l'ultimo tocco. Durante un'interazione non si chiude: foglio del BPM, regolazione, loop, ritocco aperto.
- L'animazione è breve (≤ 200 ms). Il contenuto del brano usa lo spazio liberato: il margine in fondo segue l'altezza della barra, così l'ultima riga resta leggibile.
- Impostazione "Barra: si riduce da sola / sempre aperta".
- Lo stato ridotto non deve nascondere informazioni critiche: avvisi, "Fuori dal foglio" (in breve nella mini-barra) e la nota del tempo libero.

## 3. Rallentare il brano: BPM e audio insieme
La velocità esiste già (50–100%, `preservesPitch`), ma è nascosta nel menu ⋯ e l'utente non l'ha trovata. Inoltre ragiona in **BPM**: "suonare a metà dei BPM, con l'audio sotto anche lui a metà".
- Un controllo **"Tempo"** ben visibile nella barra aperta (non nel menu ⋯):
  - mostra la percentuale e il BPM risultante della sezione corrente, per esempio «70% · ♩ 97 (di 138)»;
  - pulsanti − / + a passi del 5%;
  - scorciatoie 50% / 75% / 100%;
  - pressione lunga sui pulsanti per ripetere;
  - tocco sul valore per scrivere un BPM obiettivo: la percentuale si calcola sul BPM della sezione corrente.
- Intervallo dal **25%** al 100% (il 50% deve funzionare bene). Sotto il 50% verifica che l'audio non si zittisca: Chromium e Firefox con `preservesPitch`. Se un browser non regge, limita a quel minimo e dillo nella UI.
- L'audio, l'evidenziazione, i tic del metronomo e il conto alla rovescia seguono la velocità:
  - i tic restano sui quarti dell'audio rallentato (con allineamento: sulla griglia, al tempo × velocità);
  - nessun tic doppio o perso al cambio di velocità durante il play;
  - funziona con il seek esatto del round 12: la velocità si riapplica a ogni nuovo spezzone e dopo il loop.
- Senza audio (solo metronomo) lo stesso controllo scala il tempo, come oggi la velocità.
- La velocità è salvata per brano. Una piccola etichetta «70%» resta visibile anche nella mini-barra, così non ci si dimentica di essere rallentati.
- Il loop di una sezione con velocità ridotta è il caso d'uso tipico ("studio il ritornello al 60%"): provalo.

## 4. Bug aperti del round 12 (se resta tempo)
- I tic non seguono la regolazione "Evidenziazione" (bug 5): tic ed evidenziazione devono spostarsi insieme.
- La diagnostica perde gli ultimi 10 s (bug 4): salva anche all'uscita dal brano.

## Consegna
- Commit piccoli, `npm test` verde, niente push. Messaggi come sempre.
- e2e nuovo `test/e2e/round13.cjs` su 320, SE, 13 e 13 orizzontale:
  - colonna dei diagrammi visibile e corretta mentre scorri, con l'evidenziazione in play;
  - mini-barra che si chiude dopo 4 s e si riapre al tocco;
  - velocità al 50% con mp3 reale: tic e evidenziazione sugli attacchi rallentati, intervalli dei tic = battito / 0,5, nessun tic doppio al cambio di velocità, loop al 60%.
- Rilancia gli e2e dei round 11–12.
- `docs/reports/round-13-impl.md` con:
  - screenshot descritti, non committati;
  - le misure;
  - le decisioni, riportate anche in `docs/DECISIONS.md`;
  - una risposta finale di 15 righe al massimo.
