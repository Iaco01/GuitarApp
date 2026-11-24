# Piano di implementazione — Accordi a tempo

Questo documento traduce `docs/SPEC.md` (la specifica di prodotto) in decisioni tecniche, contratti tra moduli e round di lavoro. **La specifica dice cosa; questo documento dice come.** Se i due sono in conflitto, vale questo documento; se manca qualcosa, segui la specifica e annota la scelta in `docs/DECISIONS.md`.

## Processo

Il lavoro procede per round. Ogni round ha:

1. `docs/rounds/round-N-impl.md` — compiti per l'**implementatore** (scritto dal coordinatore).
2. L'implementatore lavora, fa girare i test, fa commit e scrive `docs/reports/round-N-impl.md` (cosa ha fatto, cosa no, dubbi).
3. Il **tester** esegue `docs/rounds/round-N-test.md`, scrive `docs/reports/round-N-test.md` con esito per criterio e bug riproducibili.
4. Il coordinatore legge i report e scrive il round successivo (correzioni + nuove funzioni).

Round previsti:

| Round | Contenuto | Milestone spec |
| --- | --- | --- |
| 1 | Scaffold, build, MHT, parser, modello, storage di base, visualizzazione, import | M1 + M2 |
| 2 | Timeline, metronomo, player, pannello, scorrimento, wake lock, durate (manuale, copia, tap) | M3 + M4 |
| 3 | Trasposizione, capotasto, diagrammi, libreria completa, export/import JSON | M5 |
| 4 | Audio sincronizzato | M6 |

## Vincoli non negoziabili

- **Zero dipendenze runtime e zero dipendenze npm in generale.** Niente `package.json` con dependencies/devDependencies. `package.json` esiste solo per gli script (`"type": "module"`).
- JavaScript moderno (ES2022), moduli ES in `src/`. Niente TypeScript, niente framework, niente bundler esterni.
- Nessuna richiesta di rete a runtime (niente font remoti, CDN, analytics).
- Test con `node --test` (Node 22). Il codice testato in Node **non deve usare il DOM**: per questo il parser lavora su stringhe (vedi sotto).
- UI in italiano. Codice, nomi di variabili e commenti in inglese.
- I file `.mht` reali non vanno mai in git (già nel `.gitignore`).

## Struttura del repository

```
index.html              shell di sviluppo: carica src/main.js come modulo + src/styles.css
src/
  html-text.js          utilità stringa: stripTags, decodeEntities, ecc. (puro)
  mht.js                decodifica MIME/MHTML (puro)
  parser.js             HTML UG -> Song (puro, niente DOM)
  chord.js              parsing nome accordo: root/quality/bass, regex di validità (puro)
  model.js              creazione/validazione/migrazione Song, utilità sezioni (puro)
  timeline.js           Song -> eventi in battiti, ricerca evento corrente (puro)      [round 2]
  transpose.js          trasposizione e capotasto (puro)                              [round 3]
  chords-db.js          dizionario forme + generatore barré (puro)                    [round 3]
  diagram.js            forma -> stringa SVG (puro)                                   [round 3]
  storage.js            localStorage (libreria) + IndexedDB (audio)
  render.js             Song -> DOM della vista brano
  player.js             metronomo Web Audio, clock, loop rAF                          [round 2]
  ui/*.js               schermate e controlli (libreria, brano, impostazioni)
  main.js               bootstrap e routing tra schermate
  styles.css
scripts/build.mjs       unisce tutto in dist/index.html
test/*.test.js          test node --test
test/fixtures/synthetic/  fixture .mht sintetiche (in git, testo inventato)
test/fixtures/local/      file reali dell'utente (fuori da git)
test/e2e/               script Playwright del tester (file .cjs)
docs/                   spec, piano, round, report, decisioni
```

## Build: `scripts/build.mjs`

- Script Node senza dipendenze: `node scripts/build.mjs` → `dist/index.html`. Anche `npm run build`.
- Strategia: **concatenazione dei moduli in ordine topologico** dentro un unico `<script type="module">`, con il CSS inline in `<style>`.
  - Lo script legge gli `import { a, b } from './x.js'` per costruire il grafo, poi rimuove le righe di import e la parola chiave `export` davanti alle dichiarazioni.
  - Convenzioni obbligatorie nei sorgenti, per far funzionare la concatenazione: solo import nominali relativi (`import { x } from './file.js'`) su una riga; solo `export function`, `export const`, `export class`; niente `export default`, niente `import *`, niente re-export, niente import dinamici.
  - **Nomi top-level univoci tra tutti i moduli**: la build fallisce con errore chiaro se due moduli dichiarano lo stesso nome top-level. Usa prefissi/nomi specifici.
- `index.html` è la shell di sviluppo; la build usa lo stesso markup sostituendo i tag `<link>`/`<script>` con il contenuto inline.
- La build stampa dimensione del file risultante. Deve funzionare aprendo `dist/index.html` sia via `file://` sia via server statico.

## Lettura del file MHTML: `src/mht.js`

API:

```js
parseMht(text) -> { headers: {lowercase-name: value}, parts: [{ headers, contentType, charset, location, body /* string decodificata */ }] }
extractMainHtml(text) -> { html, subject, url }   // prima parte text/html; subject già decodificato
decodeQuotedPrintable(str, charset='utf-8') -> string
decodeBase64(str, charset='utf-8') -> string
decodeEncodedWords(str) -> string                 // RFC 2047, es. =?utf-8?Q?...?= e =?utf-8?B?...?=
```

- Il file si legge con `file.text()` (UTF-8). Gestire CRLF e LF, header ripiegati su più righe, `boundary` con o senza virgolette.
- `Content-Transfer-Encoding`: `binary`, `8bit`, `7bit` (passthrough), `quoted-printable` (soft line break `=\r?\n`, `=XX` → byte, poi `TextDecoder(charset)`), `base64` (ignora spazi/newline → byte → `TextDecoder`).
- Se il file non è MIME (es. un `.html` salvato), `extractMainHtml` restituisce tutto il testo come HTML.
- Errori: lanciare `Error` con messaggi in italiano adatti all'utente ("Il file non contiene una pagina HTML").

## Parser: `src/parser.js` (puro, niente DOM)

API: `parseSong({ html, subject, url }) -> Song` più `parseSongFromMht(text) -> Song` che combina i due passi. In più restituisce diagnostica in `song.importInfo = { method: 'spans' | 'text-fallback', warnings: [] }`.

Perché niente `DOMParser`: i test girano in Node senza dipendenze. Il parser usa ricerca su stringhe/regex mirate, mai una regex su tutto il documento che possa andare in backtracking catastrofico su 500 KB.

### Cosa c'è davvero nel file reale (verificato sul file d'esempio)

- Header MHT: `From: <Saved by Blink>`, `Subject: AMERICAN PIE CHORDS (ver 3) by Don McLean @ Ultimate-Guitar.Com`, `Content-Type: multipart/related;` con `boundary="..."` su **riga ripiegata** (continuazione con tab). Parte HTML: `Content-Transfer-Encoding: binary`, 144 header `Content-Type` in totale.
- Il brano: `<code class="js-tab-content tabContent-code " ...>` → `<pre class="extra">` → 317 righe separate da `\n`, seguito da `</pre><span class="js-hidden-char tabContent-char">X</span>`.
- Accordi: esattamente `<span class="tabContent-chord js-chord-chord" data-original-chord="G">G</span>`, 328 occorrenze, nessun wrapper di riga.
- **Pubblicità dentro il `<pre>`**: una riga di ~114 KB inizia con `<div class="js-ab-regular"><bidding-wrapper ...><bidding-unit ...>` con altri `div`, `img`, `svg`. Va rimossa prima dell'analisi: elimina gli elementi `div`, `bidding-*`, `img`, `svg`, `script`, `style`, `iframe` (con il loro contenuto, contando l'annidamento) dentro il `<pre>`. Dopo la rimozione la riga che rimane, se vuota, è una riga vuota.
- **Annotazioni nelle righe accordi**: in 22 righe accordi compare un `*` fuori dagli span, es. `        <Em>*                         <A> *  `. La regola "solo span e spazi" è troppo rigida: una riga è comunque riga accordi se il testo fuori dagli span, tolti gli spazi, è fatto solo di token di annotazione (`*`, `**`, `|`, `-`, `(`, `)`, `x2`/`(x2)`/`2x`, `N.C.`, `/`, `.`). L'annotazione si salva sull'accordo che la precede: `{ name, col, beats, mark: "*" }`, e si mostra piccola accanto all'etichetta.
- Righe con solo spazi (es. `" "` subito dopo `[Verse 1]`): sono righe vuote.
- Righe accordi senza testo sotto (es. l'ultima, un `G`, e quelle seguite da riga vuota): righe strumentali.
- Sezioni: `[Verse 1]`, poi `[Chorus]`, `[Verse 2]`, `[Chorus]`, … fino a `[Verse 6]`, `[Chorus]`: 12 sezioni, alternate.
- Metadati: `<h1 class="tabHeader-h1">American Pie Chords by <span class="tabHeader-h2"><a …>Don McLean</a></span></h1>`; `<span class="tabHeader-name">Difficulty: </span>Beginner`; `<span class="tabHeader-name">Tuning: </span><a …>E A D G B E</a>`. Niente Capo né Key. Il titolo va normalizzato da "AMERICAN PIE" del Subject: preferisci l'h1 (`American Pie`, togliendo il suffisso " Chords"/" Tab"/…) per il titolo e lo `tabHeader-h2` per l'artista; il Subject è il fallback.
- `chordCarousel`: `<span class="chordCarousel-highlighted">G</span>` dentro ogni `chordCarousel-header`.
- **Ritmi**: tre `<article class="strumming-section …">`. Nome nel `<span class="buttonElement-label …">`, BPM in `<span class="strumming-bpm …"> 62 bpm</span>`, celle `<div class="strumming-beat [strumming-down|strumming-up] [strumming-footer strumming-footer-4]">N</div>`:
  - `Verse 1` · 62 bpm · 16 celle · `D D D - D - D - D - D - - - - -`
  - `Chorus` · 96 bpm · 8 celle · `D U D U D U D U`
  - `Verse 2 onwards` · 142 bpm · 8 celle · `D U D U D U D U`
  - Le celle con `strumming-footer` sono quelle sul battito (le altre sono suddivisioni). Salva per ogni cella anche `onBeat: true/false`: `beats: [{ dir: 'D'|'U'|'', onBeat }]`. (Questo sostituisce `beats: ['D','',…]` della spec.)
  - Il brano quindi **cambia tempo tra le sezioni**. Il parser salva tutti i pattern; come usarli in riproduzione è deciso al round 2 (vedi `docs/DECISIONS.md`).

Passi:

1. **Isola il `<pre>`**: trova l'elemento con classe contenente `js-tab-content`, poi il primo `<pre` al suo interno, e prendi l'HTML interno fino al `</pre>` corrispondente (conta i `<pre` annidati, anche se rari). Fallback: il `<pre>` più lungo della pagina.
2. **Dividi in righe** sul carattere newline (dopo aver normalizzato `\r\n`). Attenzione: gli span possono aprirsi su una riga e chiudersi su un'altra (es. wrapper di riga): lavora riga per riga sul testo con i tag, ma calcola il testo visibile con `stripTags` + `decodeEntities` (`&nbsp;`, `&amp;`, `&#39;`, `&#x..;`, ecc.).
3. **Righe accordi (metodo `spans`)**: una riga è riga accordi se contiene ≥1 span di accordo (`class` che contiene `js-chord-chord` **o** `tabContent-chord`, oppure attributo `data-original-chord` o `data-name`) e il testo visibile fuori dagli span è solo spazio. Il nome accordo è `data-original-chord` se presente, altrimenti il testo dello span. `col` = lunghezza del testo visibile prima dello span.
4. **Fallback testo** (`text-fallback`): se nel `<pre>` non c'è nessuno span accordo, una riga è riga accordi se tutte le sue parole (split su spazi) sono accordi validi secondo `isChordName` di `src/chord.js`. `col` = indice della parola. Accettare anche `N.C.`, `x2`/`(x2)` come token ignorabili in una riga accordi, ma non contarli come accordi.
5. **Sezioni**: riga il cui testo visibile, trimmato, è `[Qualcosa]` → nuova sezione con `name = "Qualcosa"`. Le righe prima della prima intestazione vanno in una sezione con `name: ""` (solo se contiene righe non vuote).
6. **Abbinamento**: riga accordi seguita da riga di testo (non vuota, non accordi, non intestazione) → `{ lyric, chords }`. Riga accordi seguita da altro → riga strumentale `{ lyric: "", chords }`. Riga di testo senza accordi sopra → `{ lyric, chords: [] }`. Le righe vuote separano ma non si salvano (al massimo una riga vuota consecutiva come `{ lyric: "", chords: [] }` se serve a leggibilità — decidi e documenta).
7. **Metadati** (cerca nell'HTML fuori dal `<pre>`; testo visibile vicino all'etichetta):
   - Titolo/artista: prima da `subject` (formati tipici: `"TITOLO CHORDS (ver 3) by ARTISTA @ Ultimate-Guitar.Com"`, maiuscole/minuscole variabili, "Chords"/"Tab"/"Ukulele" opzionali). Fallback: `tabHeader-h1`/`tabHeader-h2`, poi `<title>`.
   - `Difficulty:`, `Tuning:`, `Capo:` (es. "2nd fret" → 2; "no capo" → 0), `Key:`.
   - Elenco accordi: dall'ordine di prima comparsa nel brano (il `chordCarousel` è solo verifica incrociata; se diverso aggiungi un warning).
   - Ritmo: ogni blocco con classe contenente `strumming`: nome sezione, BPM (numero nell'elemento `strumming-bpm` o testo "NN bpm"), celle `strumming-beat` → `"D"` se `strumming-down`, `"U"` se `strumming-up`, `""` altrimenti. Se ci sono più pattern, tutti in `strumming[]`.
   - `bpm` del brano = primo BPM trovato, altrimenti `null` (la UI chiederà di inserirlo; default di riproduzione 80).
   - `timeSignature` = `[4,4]` salvo indicazioni esplicite.
8. **Durate di partenza**: ogni accordo `beats = 4` (`timingSource: "default"`).

### Validità accordi: `src/chord.js`

```js
parseChord(name) -> { root: 'A'..'G' + '#'|'b'|'', quality: string, bass: string|null } | null
isChordName(str) -> boolean
```

Regex di base più permissiva di quella della spec (copre `maj7`, `m7b5`, `7sus4`, `add9`, `6/9`, `dim7`, `aug`, `+`, `°`, slash). Test con una lista di casi validi e non validi (es. "Am", "D/F#", "Cmaj7", "F#m7b5", "Bb", "Gsus4", "Esus2", "A7sus4", "C6/9" validi; "And", "Bad", "Em," "Go", "Dad" non validi).

## Modello dati: `src/model.js`

Lo schema è quello della spec, con queste precisazioni:

```js
Song = {
  schemaVersion: 1,
  id, title, artist, difficulty, tuning, capo, key,
  bpm, timeSignature: [4,4],
  strumming: [{ section, bpm, beats: [{ dir: 'D'|'U'|'', onBeat: bool }, …] }],
  chords: ['G','D',…],                       // distinti, ordine di prima comparsa
  sections: [{ name, lines: [{ lyric, chords: [{ name, col, beats, mark?, rest? }] }] }],
  transpose: 0,
  timingSource: 'default'|'edited'|'recorded',
  view: { fontScale: 1, theme: 'dark', collapseRepeats: true },
  source: { fileName, importedAt },          // ISO string
  importInfo: { method, warnings },
  updatedAt,                                 // ISO string
  audio: null                                // round 4
}
```

- `createSong(partial)`, `validateSong(obj) -> { ok, errors }`, `migrateSong(obj)` (per import JSON futuri), `countChords(song)`, `sectionSignature(section)` (nomi accordi in sequenza, per riconoscere ritornelli identici), `baseSectionName(name)` ("Chorus 2" → "Chorus").
- `id`: `crypto.randomUUID()` (disponibile in Node 22 e browser moderni; fallback semplice se assente).
- Il JSON deve essere serializzabile così com'è (niente Map/Set/Date).

## Storage: `src/storage.js`

- Libreria in `localStorage`: `gapp.index.v1` = array `{ id, title, artist, difficulty, importedAt, updatedAt }`; ogni brano in `gapp.song.<id>`. Impostazioni globali in `gapp.settings.v1`. Impostazioni del dispositivo (latenza, round 4) in `gapp.device.v1`.
- Ogni lettura/scrittura in try/catch; errore di quota → messaggio chiaro all'utente.
- Audio (round 4) in IndexedDB `gapp-audio`, object store `files`, chiave = id brano.
- API piccola e sincrona per localStorage (`listSongs`, `getSong`, `saveSong`, `deleteSong`), asincrona per IndexedDB.
- Per i test Node, lo storage accetta un oggetto `storage` iniettato (implementa getItem/setItem/removeItem) — default `globalThis.localStorage`.

## Visualizzazione: `src/render.js` + `src/ui/`

- **Allineamento con a capo** (requisito M2): ogni riga è divisa in *segmenti* alle colonne degli accordi. Un segmento è `<span class="seg"><span class="ch">G</span><span class="ly">prima parola</span></span>` (inline-block, accordo sopra) seguito dal resto del testo del segmento come testo inline normale, così le parole lunghe vanno a capo liberamente ma ogni accordo resta incollato alla sua sillaba. Se un accordo cade oltre la fine del testo, si riempie con spazi non separabili. Se due accordi sono più vicini della larghezza dell'etichetta, il segmento si allarga (min-width = larghezza etichetta + 1ch) — accettabile che il testo si sposti di qualche carattere, mai che due etichette si sovrappongano.
- Font monospazio di sistema (`ui-monospace, SFMono-Regular, Menlo, Consolas, "Roboto Mono", monospace`).
- **Colori accordi**: palette fissa di ~10 colori ad alto contrasto su sfondo scuro e chiaro; ogni accordo distinto del brano prende un colore in ordine di prima comparsa (stabile, calcolato su `song.chords`). Ogni etichetta accordo ha `data-chord` (nome mostrato) e `data-ref="s.l.c"` (indici sezione/riga/accordo) per player e test.
- **Sezioni**: riquadro con titolo. Ripetizioni: una sezione identica (stesso nome base e stesso contenuto, testo incluso) a una precedente si può comprimere in una riga "Chorus — come sopra"; sezioni identiche consecutive si fondono in "Chorus (×2)". Interruttore `view.collapseRepeats`. In riproduzione (round 2) la sezione corrente si riapre.
- **Intestazione**: titolo, artista, difficoltà, accordatura, capotasto, BPM; fila degli accordi usati come chip colorati (i diagrammi arrivano al round 3: per ora chip col nome).
- **Controlli**: A− / A+ (scala 0.7–2.0, passo 0.1) e tema chiaro/scuro, salvati in `song.view`.
- Tocco su un accordo: per ora apre un piccolo foglio con il nome (round 3 ci mette il diagramma). Lascia il punto di aggancio (`onChordTap(ref)`).
- **Mobile-first**: nessuno scroll orizzontale a 360 px di larghezza; target di tocco ≥ 44 px; `meta viewport` corretto; `prefers-color-scheme` come default del tema.
- Schermate: **Libreria** (elenco + pulsante "Importa .mht" + stato vuoto con istruzioni su come salvare la pagina da Chrome/Safari) e **Brano**. Routing con `location.hash` (`#/`, `#/song/<id>`), così il tasto indietro del telefono funziona.
- Errori di import: messaggio leggibile, mai un'eccezione silenziosa. Mostra i `warnings` del parser in un dettaglio richiudibile.

## Riproduzione (round 2, anticipazione per non bloccare il design)

- `timeline.js`: `buildTimeline(song) -> { events: [{ ref, name, rest, startBeat, beats, sectionIndex }], totalBeats, sections: [{ index, startBeat, endBeat }] }`, `eventIndexAt(events, beat)` (ricerca binaria), funzioni pure.
- Il player calcola la posizione in battiti da un *clock* (`AudioContext.currentTime` per il metronomo, `audio.currentTime` per l'audio) dentro `requestAnimationFrame`; l'evidenziazione **non** dipende da `setTimeout`.
- Metronomo: scheduler a lookahead (timer 25 ms, finestra 100 ms), clic accentato sul primo battito, una battuta di conteggio.

## Test

- `npm test` = `node --test "test/*.test.js"`.
- Fixture sintetiche in `test/fixtures/synthetic/` generate da `test/fixtures/make-fixtures.mjs` (committate anche le uscite, così i test non dipendono dalla generazione). Testo inventato, non copiato da canzoni reali. Varianti obbligatorie:
  - `song-binary.mht` — come Chrome: `multipart/related`, HTML con `Content-Transfer-Encoding: binary`, più una parte CSS e una immagine base64 fittizie dopo l'HTML.
  - `song-qp.mht` — stessa pagina con HTML in `quoted-printable` (righe ≤ 76 caratteri, soft break, caratteri accentati UTF-8 nel testo e nel Subject codificato RFC 2047).
  - `song-base64.mht` — stessa pagina con HTML in `base64`.
  - `song-nospans.mht` — stesso brano ma il `<pre>` contiene testo semplice senza span (per il fallback).
  - `song-nostrum.mht` — senza blocco ritmo né BPM.
  - Il markup imita quello descritto nella spec (`js-tab-content`, `<pre class="extra">`, span `tabContent-chord js-chord-chord` con `data-original-chord`, `chordCarousel`, `strumming-section`/`strumming-bpm`/`strumming-beat` con `strumming-down`/`strumming-up`, `Difficulty:`, `Tuning:`), wrapper di riga e un po' di rumore di pagina (script, nav, altri `<pre>` corti).
  - `test/fixtures/synthetic/EXPECTED.md` documenta i valori attesi (sezioni, conteggio accordi, distinti, BPM…), che i test verificano tutti.
- Le fixture sintetiche devono riprodurre anche le insidie del file reale: blocco pubblicitario annidato dentro il `<pre>`, `*` nelle righe accordi, righe di soli spazi, boundary su header ripiegato, tre pattern di ritmo con BPM diversi.
- **File reale**: `test/fixtures/local/american-pie.mht` (presente nel container, fuori da git). `test/real-fixture.test.js` verifica i criteri di M1 della spec: titolo "American Pie", artista "Don McLean", difficoltà Beginner, accordatura "E A D G B E", capo 0, 12 sezioni nell'ordine Verse 1, Chorus, Verse 2, Chorus, … Verse 6, Chorus (6 + 6), 328 accordi, distinti in ordine `G D Em Am C A`, 3 pattern di ritmo (62/96/142 BPM, il primo "Verse 1" con 16 celle), `song.bpm === 62`, nessun testo della pubblicità nel brano, 22 accordi con `mark: "*"`. Se il file non esiste, il test fa `skip` con messaggio esplicito. **Mai** copiare porzioni del testo reale in file versionati, in test o nei report: le asserzioni usano conteggi e nomi di sezione, non frasi del testo.
