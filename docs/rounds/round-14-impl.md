# Round 14 — Implementatore: brani in tablatura (import da PDF, vista tab, accordi dalla tab)

Leggi `CLAUDE.md` (comprese le regole sul copyright e su MarkItDown), `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md` (sezioni "Round 12"–"Round 13") e il codice di `src/parser.js`, `src/model.js`, `src/render.js`, `src/chords-db.js`, `src/diagram.js`, `src/ui/songview.js` e `src/timeline.js`.

## Contesto: la richiesta dell'utente
L'utente ha dato un nuovo file: una pagina **tab** di Ultimate Guitar **stampata in PDF**. È in `test/fixtures/local/what-you-know-tab.pdf` (locale, fuori da git, protetto da copyright: vale la stessa regola di American Pie). Il coordinatore l'ha letta con MarkItDown. Struttura:

- **Niente testo cantato.** Solo blocchi di tablatura a 6 righe (`e|`, `B|`, `G|`, `D|`, `A|`, `E|`) con i numeri dei tasti, separati da `-` e chiusi da `|`.
- **Nomi degli accordi sopra i blocchi**, nella colonna in cui l'accordo comincia. Sono accordi in **posizioni alte** (barré al 9°–14° tasto), non le forme aperte del dizionario: per questo "sono scritti diversi".
- **Sezioni** fra parentesi quadre ("Intro/Chorus", "Verse", "Chorus/ Intro"): una sezione può avere due nomi perché la tab dice che ritornello e intro sono uguali.
- **Due parti**, separate da intestazioni del tipo `-----|Guitar 1|-----` / `-----|Guitar 2|-----`. La prima è ritmica ad accordi; la seconda è un riff melodico nota per nota (il "fingerpicking"), senza nomi di accordo.
- **Il PDF spezza le righe lunghe**: un blocco a 6 righe continua nel blocco successivo, che non ha le etichette `e|B|…`. Il nome di un accordo può stare proprio prima della continuazione.
- **Rumore della pagina** in mezzo alla tab, da togliere:
  - "Saving tab for offline usage is available in the app";
  - "CONTINUE IN THE APP";
  - "AUTOSCROLL", "LISTEN", "PDF", "Print", "Report Bad Tab";
  - valutazioni, conteggi, la lista "VERSIONS";
  - i commenti degli utenti, che possono contenere altre tab: si ignora tutto da "Print"/"Report Bad Tab"/"COMMENTS" in poi;
  - menu e piè di pagina.
- **Una legenda** dei simboli: per esempio `/` = slide up. In altre tab ci sono anche `h`, `p`, `b`, `~`, `x`, `\`, `r`.
- **Niente BPM né ripetizioni.** La tab non dice quante volte si ripete ogni parte. Il ritmo è solo suggerito dagli spazi.

Le scelte dell'utente:
- **formato**: PDF di UG (come questo);
- **vista**: la tab vera con un cursore che scorre a tempo, e di lato i diagrammi degli accordi **come sono scritti nella tab**;
- **sincronia**: per battuta, con il cursore che dentro la battuta avanza in proporzione agli spazi;
- **parti e ripetizioni**: l'utente sceglie quale chitarra seguire. L'ordine e le ripetizioni delle sezioni li ricava il motore dall'mp3, e si possono correggere.

Il lavoro è diviso in due round:
- **questo round (14)**: import, modello, vista, accordi dalla tab, play col metronomo;
- **round 15**: sincronia con l'mp3. L'utente non ha ancora dato l'mp3 del brano.

## 1. Lettura del PDF nel browser, senza dipendenze
- Modulo puro `src/pdf.js`, che deve girare in Node:
  - legge la struttura del PDF: xref, anche come stream, e object stream;
  - decomprime gli stream **FlateDecode** con `DecompressionStream('deflate')`, disponibile in Node 18+, Chromium, Firefox 113+ e Safari 16.4+. Senza di esso, mostra un messaggio chiaro con l'alternativa "incolla il testo";
  - interpreta il contenuto delle pagine: operatori di testo `BT/ET`, `Tf`, `Td/TD/Tm/T*`, `Tj/TJ/'/"`;
  - decodifica i font con **ToUnicode CMap** (bfchar/bfrange), compresi i font Type0/Identity-H.
- Ricostruisci le **righe** per coordinata y, e le **colonne** dalla x divisa per la larghezza del carattere del font monospaziato. Nelle tab l'allineamento in colonna conta: il nome dell'accordo deve stare sopra il tasto giusto. Usa le larghezze del font (`/Widths`, `/W`) o la distanza fra glifi consecutivi.
- Test:
  - un PDF sintetico generato dai test, piccolo e scritto a mano (stream compresso con `CompressionStream`), con una tab inventata;
  - il PDF reale, che si salta se manca la fixture: confronta conteggi e strutture (numero di blocchi, sezioni, parti, accordi), mai il contenuto;
  - confronto con l'output di MarkItDown (`markitdown file.pdf`) per verificare righe e colonne.
- Importa sempre anche il **testo incollato**: è utile per i test e come alternativa quando il PDF non si legge.

## 2. Parser della tab e modello
- `src/tab.js` (puro) riconosce:
  - i sistemi a 6 corde (anche con 4, 5 o 7 corde, e accordature diverse dalle etichette);
  - le continuazioni senza etichette, che vanno riattaccate al sistema precedente in base alla posizione;
  - le battute (`|`);
  - le note (tasto 0–24, numeri a 2 cifre);
  - le tecniche (`h p b r / \ ~ x`);
  - i nomi degli accordi con la loro colonna;
  - le sezioni (anche con due nomi: "Intro/Chorus" è **una** sezione con due etichette);
  - le parti ("Guitar 1/2", "Lead", "Rhythm"…);
  - l'accordatura ("Standard Tuning (EADGBe)", "Drop D"…) e il capo.
- Modello del brano tab nello stesso `song` con `kind: 'tab'` e `schemaVersion` nuovo, con migrazione:

  `parts[] → sections[] → measures[] → columns[] → { string, fret, tech }`

  - una battuta ha `beats` (predefinito 4) e la posizione relativa di ogni colonna (0..1) ricavata dagli spazi;
  - gli accordi stanno come eventi con colonna di inizio.
- Le **voci degli accordi dalla tab**: nella colonna dove compare il nome, la pila di note è la voce, ricavata dalla tab (per esempio un m7 barré al 9° tasto). Se in quella colonna ci sono poche note, guarda le colonne successive della stessa battuta.
  - Il diagramma usa quella voce, non il dizionario: `baseFret`, barré rilevato quando più corde hanno lo stesso tasto più basso, dita con `defaultFingers` di `chords-db.js`.
  - Se la voce non è riconoscibile, usa il dizionario.
- Test su tab sintetiche scritte da te (inventate, mai copiate): continuazioni, nomi di accordo prima di una continuazione, rumore di pagina in mezzo, commenti con tab da ignorare, due parti, sezioni con due nomi, numeri a 2 cifre, tecniche.

## 3. Vista tab
- La tab si mostra in **monospazio**, divisa in battute che si **ridispongono** alla larghezza dello schermo: niente scorrimento orizzontale a 360 px, con la colonna laterale dei diagrammi attiva.
  - Le battute più lunghe dello schermo vanno a capo dentro la battuta, ripetendo le etichette delle corde.
  - I nomi degli accordi restano sopra la colonna giusta.
- Le **sezioni** hanno un'intestazione, come per gli accordi. Le **parti** si scelgono con un selettore in cima ("Chitarra 1 / Chitarra 2 / tutte"), con la scelta salvata per brano.
- **Diagrammi di lato**: gli accordi della tab con la loro voce, nella colonna laterale del round 13, con i numeri delle dita. Una parte senza nomi d'accordo (riff) non mostra diagrammi, oppure mostra quelli della parte 1 nella stessa sezione: scegli tu e motiva.
- **Cursore**: una linea verticale sulla colonna corrente, più la battuta corrente evidenziata. Il foglio scorre per tenerlo in vista.
- Legenda delle tecniche toccabile (per esempio "/ = slide su").
- Trasposizione e capo: per le tab è più semplice **non** trasporre le note. Disattiva la trasposizione con una nota, e lascia il capo solo come informazione.

## 4. Play senza audio (metronomo)
- Timeline della tab: battute da `beats` battiti al BPM della sezione (predefinito 100, modificabile come per gli accordi). Il cursore avanza nella battuta in proporzione alle posizioni delle colonne.
- Tic sui battiti, accento sulla battuta, velocità del round 13, loop di sezione: tutto come per i brani ad accordi.
- **Ordine delle sezioni** ("arrangiamento"):
  - una lista modificabile, per ora a mano: per esempio Intro/Chorus, Verse, Intro/Chorus, Verse… con ripeti, sposta e togli;
  - la proposta iniziale è l'ordine della tab, una volta;
  - nel round 15 l'ordine lo proporrà il motore dall'mp3.

## 5. Per il round 15 (non farlo ora, ma prepara il modello)
- Sincronia con l'mp3 per battuta. Per ogni battuta si costruisce un **profilo di note** (le classi di altezza dei tasti suonati, dalla tab e dall'accordatura), usato come modello di emissione al posto dell'accordo: così si allinea anche il riff nota per nota.
- L'arrangiamento lo trova il motore, con un grafo di sezioni in cui ogni sezione può seguire qualsiasi altra con un costo.
- Il modello deve già permettere di mettere per ogni battuta `startSec`/`endSec`, e per ogni parte la scelta di quale guidare.

## Consegna
- Commit piccoli, `npm test` verde, niente push, messaggi come sempre.
- **Nessun contenuto della tab reale** nei file committati, nei report e negli screenshot committati: solo conteggi e nomi di sezione, di parte e di accordo.
- e2e `test/e2e/round14.cjs` su 320, SE, 13 e 13 orizzontale:
  - import del PDF reale (si salta senza fixture) e di un PDF sintetico;
  - vista tab senza scorrimento orizzontale;
  - accordi sopra la colonna giusta;
  - diagrammi della voce della tab;
  - selettore delle parti;
  - play col cursore che avanza per battuta e tic;
  - loop;
  - velocità al 50%.
- Guarda gli screenshot.
- `docs/reports/round-14-impl.md` con:
  - cosa si legge del PDF reale (blocchi, battute, parti, sezioni, accordi trovati con la loro voce);
  - cosa non si legge;
  - le decisioni, riportate anche in `docs/DECISIONS.md`;
  - una risposta finale di 15 righe al massimo.

## Aggiunte dell'utente (durante il round)

### A. Capotasto
L'utente dice che il capo è indicato. Nel testo del PDF reale il coordinatore **non lo trova**: né MarkItDown né una ricerca negli stream decompressi. Può essere disegnato in un font senza ToUnicode, oppure stare in un elemento grafico.
- **Parser** (tab e fogli di accordi): riconosci "Capo: 2nd fret", "Capo 2", "Capo on 2", "capo II", "Capo: no capo", in inglese e in italiano ("capotasto al 2° tasto"), anche nell'intestazione della pagina. Se nel PDF ci sono glifi non decodificati vicino a "Tuning", riportalo nel report.
- **Modello**: `capo` del brano. Nelle tab di UG i tasti sono scritti **rispetto al capo**: un tasto 0 scritto è il capo, quindi l'altezza suonata è corda vuota + capo + tasto scritto. Usalo per il synth (punto B) e per il profilo di note del round 15.
- **UI**:
  - il capo letto si vede in cima, per esempio "Capo 2° tasto";
  - si può impostare o cambiare a mano dal foglio del capo, quello che esiste già;
  - è salvato per brano;
  - i diagrammi restano relativi al capo, come la tab.

### B. Chitarra sintetica che suona la tab a tempo
L'utente vuole sentire la tab suonata da una "chitarra synth", a tempo col cursore.
- **Sintesi in Web Audio senza dipendenze**: corda pizzicata Karplus-Strong, con un `AudioWorklet` creato da un Blob se disponibile, altrimenti note pre-renderizzate in `AudioBuffer`. Il timbro deve essere da chitarra: attacco breve, decadimento naturale, un filtro passa-basso che chiude nel tempo.
- **Altezza**: corda vuota dell'accordatura + capo + tasto. Accordatura dalla tab, con "Standard" come predefinita.
- **Durata**: ogni nota suona fino alla nota successiva sulla stessa corda, oppure fino a fine battuta più una coda breve.
- **Tecniche**:
  - `/` e `\` slide: glissando di altezza fino alla nota successiva;
  - `h`/`p`: legato, nuova nota senza nuovo attacco forte;
  - `b`: bend di 1 semitono, o di quanto è scritto;
  - `r`: rilascio;
  - `~`: vibrato leggero;
  - `x`: nota stoppata, breve e smorzata.
- **Accordi** (più note nella stessa colonna): pennata con le corde sfalsate di 8–15 ms dal basso verso l'alto.
- **Tempo**: le note si programmano con lo stesso orologio e lo stesso scheduler del metronomo (lookahead), sulla timeline della tab.
  - Seguono la velocità del round 13: la sintesi resta all'altezza giusta, cambia solo il tempo.
  - Seguono loop, seek e pausa senza note doppie né note che restano appese.
- **Parti**: suona la parte scelta, oppure tutte. Con "tutte", la parte 1 si può abbassare o togliere.
- **Controlli** nel pannello:
  - "Chitarra synth: sì/no";
  - volume;
  - "Solo synth / synth + metronomo".
  - Più avanti, con l'mp3, servirà "synth + mp3" per confrontare.
- **Test**:
  - unità: altezze in Hz di corda e tasto con il capo; programma di note dalla timeline, con il numero di note per battuta e i tempi;
  - e2e: intercetta le note programmate (come per i tic) a 100% e 50%, nel loop, e dopo pausa e ripresa;
  - un controllo audio: OfflineAudioContext, frequenza fondamentale misurata ±10 cent.
