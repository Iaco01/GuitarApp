# Piano: app accordi a tempo (per Claude Code)

Nov 24, 2026 · @Iacopo

## Obiettivo e ambito

Una pagina web per telefono che importa una pagina di Ultimate Guitar salvata (.mht), la mostra in modo leggibile e la suona a tempo, evidenziando l'accordo corrente che avanza col metronomo. Così si vede subito per quanto tenere ogni accordo.

In questa prima versione:

- Importazione del file .mht salvato dal browser (niente testo incollato, per ora).
- Visualizzazione pulita di accordi, testo e sezioni.
- Riproduzione a tempo: metronomo oppure audio della canzone sincronizzato, accordo evidenziato che avanza, scorrimento automatico.
- Trasposizione, suggerimento capotasto, diagrammi accordi, libreria locale.

Niente microfono: l'ascolto di quello che suoni resta per una versione futura (vedi l'ultima sezione).

## Formato di input: pagina Ultimate Guitar salvata

Il file d'esempio (accordi di un brano, versione 3, circa 500 KB) è una pagina salvata da Chrome in formato MHTML: un messaggio MIME `multipart/related`, con la parte `text/html` principale per prima, seguita da CSS e immagini. Nell'esempio le parti hanno `Content-Transfer-Encoding: binary`, ma il parser deve gestire anche `quoted-printable` e `base64`, perché altri browser li usano.

Dove stanno i dati nell'HTML:

| Dato | Dove si trova | Valore nell'esempio |
| --- | --- | --- |
| Corpo del brano | `<code class="js-tab-content">` → `<pre class="extra">` | 317 righe |
| Accordi | `<span class="tabContent-chord js-chord-chord" data-original-chord="G">G</span>` dentro le righe del `<pre>` | 328 accordi, 6 distinti |
| Sezioni | righe di solo testo tra parentesi quadre, es. `[Verse 1]`, `[Chorus]` | 12 sezioni (6 strofe, 6 ritornelli) |
| Titolo e artista | header `Subject:` dell'MHT e `tabHeader-h2` | presenti |
| Difficoltà, accordatura | testo dopo `Difficulty:` e `Tuning:` nell'header della pagina | Beginner, E A D G B E |
| Capotasto, tonalità | `Capo:` / `Key:` se presenti | assenti (nessun capo) |
| Elenco accordi | blocco `chordCarousel` sotto “Transpose” | G D Em Am C A |
| Ritmo e BPM | `strumming-section`: nome sezione, `strumming-bpm`, celle `strumming-beat` con classi `strumming-down` / `strumming-up` | Verse 1, 62 bpm, 16 celle |

Regola chiave per gli accordi: dentro il `<pre>`, una riga che contiene solo span di accordi e spazi è una **riga accordi**; la riga di testo subito sotto è la riga a cui si appoggia. La colonna di ogni accordo (numero di caratteri prima dello span, dopo aver tolto i tag) dice sopra quale sillaba cade. Una riga accordi senza testo sotto è una battuta strumentale.

Robustezza: Ultimate Guitar cambia spesso le classi CSS. Se gli span non si trovano, il parser ripiega sul testo semplice del `<pre>` e riconosce le righe accordi con una regex (ogni parola della riga è un accordo valido, es. `^[A-G][#b]?(m|maj|min|dim|aug|sus|add)?\d*(\/[A-G][#b]?)?$`). Il ritmo è facoltativo: se manca, si usa 4/4 e un BPM inserito a mano.

Nota sul file di prova: contiene il testo del brano, protetto da copyright. Va usato solo in locale come fixture di test, fuori da repository pubblici (aggiungerlo al `.gitignore`).

## Modello dati della canzone

Il parser produce un unico oggetto JSON, salvato tale e quale nella libreria. Tutto il resto dell'app legge solo da qui, mai dall'HTML.

```json
{
  "id": "uuid",
  "title": "…", "artist": "…",
  "difficulty": "Beginner", "tuning": "E A D G B E",
  "capo": 0, "key": null,
  "bpm": 62, "timeSignature": [4, 4],
  "strumming": [{ "section": "Verse 1", "bpm": 62, "beats": ["D", "", "D", "U", …] }],
  "chords": ["G", "D", "Em", "Am", "C", "A"],
  "sections": [
    { "name": "Verse 1", "lines": [
      { "lyric": "testo della riga",
        "chords": [ { "name": "G", "col": 2, "beats": 4 }, { "name": "D", "col": 8, "beats": 4 } ] }
    ] }
  ],
  "transpose": 0,
  "timingSource": "default"
}
```

- `col` è la colonna del carattere sopra cui cade l'accordo, per allinearlo alla sillaba giusta.
- `beats` è la durata dell'accordo in battiti: è il dato che fa avanzare l'evidenziazione (vedi la sezione sulla riproduzione).
- `timingSource` vale `default` (durate stimate), `edited` (corrette a mano) o `recorded` (registrate col tap).
- La trasposizione non riscrive gli accordi: si salva solo `transpose` e la conversione avviene in fase di visualizzazione, così l'originale non si perde.
- Le sezioni ripetute (es. sei ritornelli identici) restano tutte nella lista, così la riproduzione segue l'ordine reale del brano.

Con un audio caricato il modello aggiunge solo un campo `audio`: chiave IndexedDB, nome file, durata, offset, BPM dell'audio e calibrazione della latenza. I tempi dei singoli accordi non si salvano, perché si ricavano da offset, BPM e durate in battiti.

## Visualizzazione

La schermata del brano è pensata per un telefono appoggiato al leggio: testo grande, tema scuro, niente distrazioni.

- **Intestazione:** titolo, artista, difficoltà, accordatura, capotasto e BPM, più una fila di diagrammi degli accordi usati.
- **Accordi sopra il testo:** ogni accordo è un'etichetta colorata posizionata sopra la sua sillaba in base a `col`, in font monospazio per mantenere l'allineamento. Un colore fisso per ogni accordo, così i cambi si riconoscono a colpo d'occhio.
- **Sezioni:** ogni sezione è un riquadro con il suo nome. I ritornelli dopo il primo si possono comprimere in una riga “Ritornello (×2)”, ma durante la riproduzione si riaprono.
- **Righe lunghe:** su schermi stretti la riga va a capo insieme agli accordi sopra, senza perdere l'allineamento (accordo e sillaba restano nello stesso blocco).
- **Controlli:** dimensione del testo (A− / A+) e tema chiaro/scuro, ricordati per ogni brano.
- **Tocco su un accordo:** apre il suo diagramma in grande.

## Riproduzione a tempo con accordo evidenziato

Il brano diventa una sequenza di eventi-accordo in battiti. Il metronomo avanza e l'app evidenzia l'accordo in corso, mostra il prossimo e quanti battiti mancano al cambio. Il problema da risolvere è che Ultimate Guitar non dice quanto dura ogni accordo, quindi le durate hanno tre livelli.

### Durate degli accordi

1. **Stima di partenza:** ogni accordo dura una battuta (4 battiti in 4/4). Un'impostazione globale “battiti per accordo” (2, 4 o 8) cambia la stima per tutto il brano.
2. **Correzione a mano:** in modalità modifica tocchi un accordo e ne regoli i battiti con + / −. Le correzioni fatte sul primo ritornello si possono copiare su tutti i ritornelli identici.
3. **Registrazione col tap:** parte il metronomo, tu suoni e tocchi un grande pulsante a ogni cambio di accordo. L'app arrotonda ogni tocco al battito più vicino e salva le durate. Si può rifare una sola sezione. È il modo più veloce per avere tempi giusti.

### Durante la riproduzione

- **Metronomo:** Web Audio API con scheduler a lookahead (timer \~25 ms, programmazione \~100 ms avanti), così il tempo resta preciso anche se la pagina rallenta. Clic accentato sul primo battito e una battuta di conteggio prima di partire.
- **Accordo corrente:** etichetta piena e ingrandita, con una barra che si riempie durante i suoi battiti. Il prossimo accordo è bordato, con il numero di battiti mancanti.
- **Pannello fisso in basso:** accordo corrente grande, prossimo accordo, pallini dei battiti della battuta e schema di ritmo (giù/su) della sezione, se presente nel file.
- **Scorrimento:** la riga corrente resta nel terzo superiore dello schermo, con scorrimento morbido.
- **Controlli:** play/pausa, BPM regolabile (40–200) e tap tempo, velocità di studio (50–100%), loop di una sezione con pressione prolungata, tocco su un accordo per ripartire da lì.
- **Schermo acceso:** Screen Wake Lock API durante la riproduzione. Se non è supportata, un avviso lo dice.

## Audio sincronizzato

Carichi il file audio della canzone (mp3, m4a, wav) e l'app lo suona sotto il brano. L'audio diventa l'orologio e l'accordo evidenziato segue il punto della registrazione. Il file resta sul telefono, non viene caricato da nessuna parte.

Per ora l'app è pensata per versioni in studio, semplici e a BPM fisso (niente live). Quindi la sincronizzazione è una sola, offset + BPM:

1. Si parte dal BPM preso da Ultimate Guitar.
2. Tocchi sul primo accordo per fissare l'inizio (offset), con regolazione fine di ±50 ms.
3. Se l'audio va più veloce o più lento, correggi il BPM con + / − (anche di 0,5) o col tap tempo.

Il tempo di ogni accordo si calcola da offset, BPM e durate in battiti, le stesse usate senza audio. Se a fine brano l'evidenziazione è in anticipo o in ritardo, il BPM è leggermente sbagliato: un'indicazione lo suggerisce (“prova 0,5 BPM in più”).

Durante la riproduzione con audio:

- L'accordo corrente è l'ultimo con `t` già passato. Prossimo accordo e conto alla rovescia restano visibili.
- Toccando un accordo, l'audio salta a quel punto.
- Velocità 50–100% senza cambiare l'intonazione (`playbackRate` con `preservesPitch`).
- Loop di una sezione direttamente sull'audio.
- Metronomo spento di default, attivabile sopra l'audio.
- Intro o assoli senza accordi nel foglio: in modalità modifica si aggiungono battute di pausa, così il conteggio resta allineato all'audio.

Dettagli tecnici:

- Elemento `<audio>`, con posizione letta a ogni frame (`requestAnimationFrame` su `currentTime`) per un'evidenziazione fluida.
- Compensazione della latenza: con le casse o cuffie Bluetooth il suono arriva in ritardo. Si parte da `AudioContext.outputLatency` e c'è uno slider di calibrazione salvato per dispositivo.
- L'audio va in IndexedDB, collegato al brano. L'esportazione JSON della libreria salva i tempi ma non l'audio, che è troppo pesante: dopo un'importazione basta ricaricare il file.
- Più avanti: rilevamento automatico dei battiti nell'audio per proporre i cambi, da confermare a mano.

## Strumenti

- **Trasposizione:** pulsanti − / + di mezzo tono. Ogni accordo viene scomposto in fondamentale, qualità e basso (es. `D/F#`), si trasla la fondamentale e anche il basso. Diesis o bemolle scelti in base alla tonalità risultante (es. B♭ e non A# in Fa).
- **Suggerimento capotasto:** per capotasto da 0 a 7 l'app calcola le forme da suonare (accordi trasposti in giù del numero di tasti) e dà un punteggio di facilità. Gli accordi aperti (C, G, D, A, E, Am, Em, Dm) valgono poco, i barré e quelli rari valgono molto. Mostra le 3 opzioni migliori, es. “Capo 2: forme G, C, D”.
- **Diagrammi accordi:** dizionario interno delle forme comuni (aperte, barré su Mi e La, sus, 7, maj7, slash più comuni), disegnati in SVG. Se un accordo manca dal dizionario, si mostra il nome con la scritta “diagramma non disponibile”. Nessuna richiesta esterna.
- **Libreria:** elenco dei brani importati con titolo, artista, difficoltà e data, con ricerca. Si salvano anche le impostazioni per brano (trasposizione, BPM, durate, dimensione testo). Esportazione e importazione della libreria in JSON, per backup o per passarla su un altro dispositivo.

## Architettura tecnica

Una web app statica, senza server e senza dipendenze esterne, che funziona offline sul telefono. Il parser trasforma il file in JSON una volta sola. Vista e player leggono solo quel JSON.

&#91;embedded content: architettura · dal file al player\]

- **Sorgenti:** moduli ES in `src/` (`mht.js`, `parser.js`, `model.js`, `render.js`, `player.js`, `transpose.js`, `chords-db.js`, `storage.js`) e un `index.html`. Uno script Node senza dipendenze li unisce in un unico `dist/index.html` da aprire sul telefono.
- **Lettura file:** `<input type="file" accept=".mht,.mhtml,.html">`, lettura come testo, decodifica MIME (binary, quoted-printable, base64) e `DOMParser` sulla parte HTML.
- **Salvataggio:** `localStorage` basta per centinaia di brani (un brano è qualche decina di KB). I file audio invece vanno in IndexedDB, che regge file di parecchi MB. I dati restano in quel browser, per questo c'è l'esportazione JSON.
- **Test:** `node --test` su parser e trasposizione, usando il file d'esempio come fixture locale (fuori da git). Verifiche dei conteggi nella sezione delle milestone.
- **Compatibilità:** Chrome su Android e Safari su iOS recenti. L'audio si sblocca solo dopo un tocco dell'utente, quindi l'`AudioContext` si crea al primo play.

## Milestone e criteri di accettazione

Ogni milestone si chiude solo quando i suoi criteri passano sul file d'esempio, provato su un telefono vero.

1. **Parser e modello dati.** Dal file d'esempio escono: titolo e artista; difficoltà Beginner; accordatura E A D G B E; capotasto 0; 12 sezioni nell'ordine giusto (6 strofe e 6 ritornelli); 328 accordi; 6 accordi distinti (G, D, Em, Am, C, A); almeno una sezione di ritmo a 62 BPM. Test automatici con `node --test`.
2. **Visualizzazione.** Il brano si legge sul telefono senza zoom. Ogni accordo sta sopra la sillaba giusta, anche quando la riga va a capo. Testo più grande o più piccolo e tema chiaro/scuro funzionano.
3. **Riproduzione.** Il metronomo resta a tempo per 5 minuti senza scarti udibili. L'accordo evidenziato cambia esattamente sul battito previsto dalle durate. Prossimo accordo e battiti mancanti sono sempre visibili. Lo schermo non si spegne durante il play.
4. **Durate.** Correzione a mano con + / −, copia sui ritornelli identici, registrazione col tap con arrotondamento al battito. Le durate restano salvate dopo la chiusura della pagina.
5. **Strumenti e libreria.** Trasposizione su e giù di 12 semitoni che torna all'originale. Suggerimento capotasto con 3 opzioni. Diagrammi per tutti e 6 gli accordi dell'esempio. Libreria con ricerca, esportazione e importazione JSON.

6) **Audio sincronizzato.** Con l'mp3 di un brano in studio a BPM fisso, dopo aver fissato offset e BPM, l'accordo evidenziato resta entro 100 ms dal cambio reale per tutta la durata. Funzionano il salto toccando un accordo, la velocità al 75% senza cambio di intonazione e la calibrazione con cuffie Bluetooth.

## Fuori ambito e sviluppi futuri

Fuori dalla prima versione, da non implementare ora:

- **Microfono:** accordatore, riconoscimento dell'accordo suonato e controllo del ritmo. Il modello dati è già pronto (sequenza di accordi con tempi), quindi si aggiunge come modulo separato senza toccare il resto.
- **Testo incollato:** importazione da testo copiato. Il parser ha già il ripiego sul testo semplice, quindi basta una casella di input.
- **Download diretto da Ultimate Guitar:** niente scraping del sito. Si importa solo ciò che l'utente salva.
- **Account e sincronizzazione** tra dispositivi: per ora basta l'esportazione JSON.
- **Tablature** (righe tipo `e|---`): il file d'esempio non ne contiene. Se compaiono, per ora vengono mostrate come testo, senza animazione.

* **Brani a tempo variabile** (live, intro libere, accelerazioni): servirebbe registrare l'istante di ogni cambio sull'audio, col tap. Rimandato finché si usano solo versioni in studio a BPM fisso.
