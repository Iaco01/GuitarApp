# Round 11 — Implementatore: tic su una griglia vera, ritocco affidabile

Leggi `CLAUDE.md`, `docs/reports/round-10-test.md` (bug 1–18), `docs/reports/round-10-impl.md`, `docs/DECISIONS.md` (sezione "Round 10") e gli script del tester `test/e2e/round10-tester-*`. In `test/regression/` ci sono 8 `todo`: diventano test normali in `test/` che passano. I test sul reale si saltano se manca la fixture. Rimuovi la cartella se resta vuota.

L'utente usa l'app col metronomo e l'mp3 sincronizzato: **il tic regolare e il ritocco sono la priorità**, prima del motore.

## 1. Media — Tic su una griglia continua (bug 9, 10, 11, 12)
Oggi i tic ripartono da ogni inizio accordo, quindi il clic "balla" e il numero di tic è ±1 rispetto ai quarti veri.
- Nelle sezioni a tempo stabile i tic stanno su una **griglia continua di battiti**:
  - usa i battiti trovati dal motore (`beatTimes` della sezione: salvali nell'allineamento in forma compatta, per esempio BPM + fase + piccoli scarti, oppure i tempi arrotondati ai ms);
  - oppure una griglia regolare (inizio + k × periodo) adattata ai cambi.
- Ogni accordo ha i tic della griglia che cadono nel suo intervallo. Il numero di quarti di un accordo deriva dalla griglia, non da `round(durata/periodo)`.
- Coerenza tra sorelle: dove le sezioni con gli stessi accordi differiscono di ±1 quarto in poche posizioni, **non** forzare (può essere musica vera); riporta però quante differenze restano sul reale.
- Accenti: il primo tempo segue la battuta della griglia, cioè ogni 4 battiti dall'inizio della sezione o dal primo cambio. Riporta come lo scegli.
- Tempo libero: un tic su ogni cambio d'accordo, accentato, più i tic intermedi al tempo vicino solo se l'accordo dura almeno 2 battiti di quel tempo. Il suono non deve "inciampare".
- Ultimo accordo: i tic finiscono quando finisce l'audio o la musica (bug 10).
- Loop: nessun tic perso al riavvolgimento (bug 11).
- Il pannello mostra lo stesso BPM della schermata di sincronizzazione (bug 12).
- Test:
  - sul reale la deviazione degli intervalli tra tic oltre ±15% deve passare dal 17% a < 2% nelle sezioni stabili;
  - nessun tic a meno di 0,6 battiti dal precedente;
  - sul sintetico il numero di tic è esatto per accordo e l'errore è < 30 ms.

## 2. Media — Ritocco (bug 1, 2, 3, 4)
- Dopo un ritocco i tic e i quarti si ricalcolano dalla griglia, oppure i quarti dell'accordo ritoccato e del vicino si ricalcolano. Mai 2–4 tic in 0,1 s (bug 1).
- Un ritocco accanto a un gap non cancella il gap: il gap si accorcia o si allunga, e sparisce solo se scende sotto la soglia (bug 2).
- Il pulsante ⇄ deve comparire sull'intestazione di ogni sezione dopo la sincronizzazione e dopo il reload (bug 3). Aggiungi un test e2e che lo cerca.
- Pressione lunga (bug 4):
  - il rilascio non deve premere il pulsante che appare sotto il dito (ignora il primo `click`/`pointerup` per circa 300 ms dopo l'apertura, oppure apri il foglio lontano dal dito);
  - tolleranza di movimento di almeno 10 px;
  - `user-select: none` e `-webkit-touch-callout: none` sugli accordi;
  - nessun menu contestuale di iOS.
- Scoperta (bug 14): la prima volta che si apre un brano sincronizzato mostra una riga discreta, una sola volta: "Tieni premuto un accordo per spostarlo un po' avanti o indietro".

## 3. Media — Tagli a inizio brano e a metà sezione (bug 5, 6, 7)
- Reale senza i primi 60 s: le sezioni che suonano non devono essere "non presenti". Il salto all'inizio va trattato come il taglio in coda.
- Taglio a metà di una sezione (45%): la sezione tagliata è parziale, con i suoi eventi finali saltati, e non va compressa. Mai verde con cambi sbagliati.
- Taglio al 20%: va riconosciuto se la parte presente è allineabile.

## 4. Bassa — Il resto
- Strofe identiche (bug 8): quando l'app segna "non presente" una strofa fra più strofe uguali, l'avviso lo dice ("una delle strofe manca: se è un'altra, usa ⇄ o Correggi a orecchio"). Se è semplice, scegli per ordine del testo: la mancante è quella che lascia il resto più coerente.
- Ancore e ritocco di sezione (bug 13): il ritocco prevale sulle ancore manuali di quella sezione, oppure chiede quale tenere.
- «Cambio!» dietro la barra a 320 px.
- "1 sezioni" → "1 sezione".
- Prestazioni: frame più lungo tornato al livello del round 9.

## Consegna
- Commit piccoli, `npm test` verde, niente push, messaggi come sempre.
- Rilancia `test/e2e/round10-regress.sh` e gli e2e del tester del round 10.
- `docs/reports/round-11-impl.md` con:
  - tabella prima/dopo dei tic sul reale e sul sintetico;
  - ritocco;
  - tagli;
  - le decisioni, riportate anche in `docs/DECISIONS.md`;
  - una risposta finale di 15 righe al massimo.
