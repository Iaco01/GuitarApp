# Round 6 — Implementatore: durate stimate dalla posizione e BPM regolabile dal pannello

Segnalazioni dell'utente dopo la v1:
1. "Non tutti gli accordi durano 4/4: dovresti poterlo vedere dall'mht."
2. "Dovrei poter cambiare il BPM se non si adegua al brano."

Leggi `CLAUDE.md`, `docs/DECISIONS.md` (incluse "Round 5" e "Limiti noti della v1"), `docs/reports/round-5-test.md` e il codice di `src/model.js`, `src/timeline.js`, `src/player.js`, `src/ui/songview.js`, `src/ui/playpanel.js`.

## Cosa c'è (e cosa no) nel file

Il coordinatore ha controllato il file reale: **non contiene durate esplicite**. Non ci sono stanghette di battuta né dati nascosti in JSON, e il ritmo UG è un solo pattern di una battuta per sezione. L'unica informazione sulle durate è **dove cade ogni accordo sul testo cantato**: la sillaba sopra cui sta. Nel file reale la distanza in sillabe tra un accordo e il successivo varia molto, da 1 a più di 12. Oggi l'app la ignora e dà a tutti 4 battiti. Esempio (conteggi, non testo):
- una riga di 13 sillabe con 3 accordi, alle sillabe 0, 4 e 10;
- poi una riga di 5 sillabe con un solo accordo;
- più avanti una riga di 8 sillabe con 4 accordi ravvicinati, alle sillabe 0, 2, 3 e 4.

## 1. Stima delle durate dalla posizione: `src/durations.js` (puro)

```js
countSyllables(word) -> number                 // euristica per inglese e italiano, sotto
syllableMap(lyric) -> [{ start, end }]          // intervalli di colonna di ogni sillaba della riga
estimateSectionDurations(section, { timeSignature, grid = 2, minBeats = 2, beatsPerChordAvg = 4 }) -> beats[] (uno per accordo della sezione, in ordine)
estimateSongDurations(song, opts) -> song       // nuova copia con beats stimati; timingSource 'estimated'
```

Algoritmo (sezione per sezione, la sezione è un flusso continuo di sillabe):
1. **Sillabe.** Per ogni riga con testo, dividi le parole in sillabe con un'euristica (gruppi vocalici `[aeiouyàèéìòù]+`, `e` muta finale inglese non conta, ogni parola ≥ 1). Assegna a ogni sillaba un intervallo di colonne nella riga, così da sapere su quale sillaba cade `col`.
2. **Posizione dell'accordo** nel flusso = sillabe delle righe precedenti della sezione + indice della sillaba su cui cade `col` (se `col` cade su uno spazio, la sillaba successiva; se cade oltre la fine del testo, la fine della riga).
3. **Righe strumentali** (accordi senza testo): ogni accordo vale `beatsPerChordAvg / ritmoMedio` sillabe equivalenti, in pratica una battuta, a meno che le colonne non dicano altro (accordi a distanza ≤ 4 caratteri = mezza battuta).
4. **Durata in sillabe** di ogni accordo = posizione dell'accordo successivo − posizione di questo. L'ultimo accordo della sezione arriva a fine sezione (sillabe rimaste + 2 sillabe di respiro).
5. **Da sillabe a battiti**: un solo fattore per sezione, `r` battiti per sillaba, scelto in modo che la **durata media** sia `beatsPerChordAvg` (default 4, cioè una battuta in 4/4). Poi **arrotonda le posizioni cumulative**, non le singole durate, alla griglia (`grid` = 2 battiti, mezza battuta) con minimo `minBeats`. Infine porta il totale della sezione a un multiplo di `timeSignature[0]`, aggiustando l'ultimo accordo.
6. Accordi ravvicinati sulla stessa sillaba o su sillabe adiacenti: minimo 2 battiti, ma se ce ne sono 3+ in ≤ 3 sillabe usa griglia 1 per quel tratto (cambi rapidi).

Requisiti e test:
- Sul file reale con `beatsPerChordAvg = 4`:
  - ogni sezione ha un totale multiplo di 4;
  - nessuna durata < 1;
  - la durata media per sezione è tra 3 e 5;
  - le durate non sono tutte uguali (almeno 3 valori diversi nel brano);
  - un accordo con più sillabe dura sempre ≥ di uno con meno sillabe nella stessa sezione, salvo arrotondamento di ±2.
- Sezioni identiche (ritornelli uguali) → durate identiche.
- Test sintetici con risultato atteso esatto, per esempio:
  - 4 accordi distribuiti uniformemente su 16 sillabe → 4,4,4,4;
  - accordi alle sillabe 0, 8, 12 di 16 → 8,4,4;
  - riga strumentale → una battuta per accordo.
- Prestazioni: tutto il brano reale in < 20 ms.

## 2. Integrazione

- **All'import** le durate si stimano subito (`timingSource: 'estimated'`).
- **Migrazione** (`schemaVersion` 3): i brani già in libreria con `timingSource: 'default'` ricevono la stima. Quelli `edited`/`recorded` non si toccano.
- **Impostazioni del brano**: il vecchio "Battiti per accordo 2/4/8" diventa "Durate":
  - **Stimate dal testo** (consigliato), con "durata media" 2/4/8 che passa `beatsPerChordAvg`;
  - **Fisse** 2/4/8 come prima.
  - Se ci sono durate modificate a mano o registrate, chiedi conferma prima di riscriverle, come oggi.
- In modalità "Modifica durate" un piccolo avviso dice da dove vengono: "Durate stimate dalla posizione degli accordi sul testo: controllale e correggile con −/+ o con la registrazione a tap".
- **Riproduzione con audio**: le durate stimate entrano nella timeline come quelle manuali; le ancore continuano a funzionare.

## 3. BPM regolabile dal pannello, durante il play

Oggi il BPM si cambia solo dal piccolo pulsante "♩ = 62" nell'intestazione di ogni sezione, o con il tap tempo nascosto dietro "⋯"; il pannello mostra il BPM ma non lo fa modificare. Serve un controllo diretto.

- Nella **riga principale** del pannello, al posto del solo "♩ = 62": `−  ♩ 62  +`. Il tocco su − / + cambia di 1 BPM; la pressione prolungata ripete (5 al secondo). Il tocco sul numero apre un campo per scriverlo e il tap tempo.
- **Ambito della modifica**, scelto con un interruttore accanto (ricordato per brano):
  - **"Tutto il brano"** (default): tutte le sezioni cambiano **in proporzione** (fattore `k = nuovo / vecchio` sul BPM della sezione corrente), così 62/96/142 diventano per esempio 64/99,1/146,6. Rapporti invariati, arrotondamento a 0,1.
  - **"Solo questa sezione"**: cambia solo la sezione corrente (e quelle con lo stesso nome base, se l'utente lo chiede nel campo).
- **Durante il play la modifica non deve far saltare la posizione**: ricostruisci la timeline e riancora il clock sul **battito corrente**. La posizione in battiti resta identica, cambia solo la velocità da lì in poi; nessun conteggio e nessun clic doppio. Test puro: dato un istante a metà di un accordo, dopo il cambio di BPM l'evento corrente e la frazione del battito sono invariati.
- **Con l'audio caricato**: − / + cambiano i BPM salvati delle sezioni (stesse regole) e quindi dove cade l'evidenziazione rispetto all'audio. Il pannello mostra quanto è stato spostato ("+2 BPM su tutto il brano") e c'è "Annulla" per tornare ai valori precedenti. La velocità di riproduzione (50–100%) resta un controllo separato.
- Le modifiche si salvano subito (`bpmSource: 'edited'`) e restano dopo il reload.
- Il pannello in play non deve diventare più alto di oggi di oltre 8 px. Misuralo su 360 px, iPhone SE e iPhone 13.

## 4. Consegna

- Commit piccoli, test verdi, niente push, messaggi come sempre.
- Playwright sul file reale:
  - mostra le durate stimate in modalità modifica (screenshot);
  - durante il play premi + cinque volte e verifica che l'evento corrente non salti e che i cambi successivi arrivino col nuovo tempo, misurato con `window.__gapp`;
  - fai la stessa verifica con l'audio sintetico.
  - Guarda gli screenshot.
- In `docs/reports/round-6-impl.md`:
  - una tabella con, per la prima strofa e il primo ritornello del file reale, solo **nome accordo, sillabe assegnate e battiti stimati** (niente testo);
  - i limiti dell'euristica.
- Aggiorna `docs/DECISIONS.md` (sezione "Round 6") e la sezione "Funzioni" del README.
