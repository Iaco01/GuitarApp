# Valori attesi dalle fixture sintetiche

Generate da `test/fixtures/make-fixtures.mjs` (`npm run fixtures`). Testo inventato. Tutti i valori sono verificati da `test/parser.test.js`.

Varianti: `song-binary` (transfer encoding binary, LF), `song-qp` (quoted-printable, CRLF, Subject RFC 2047 con due parole codificate Q + B), `song-base64`, `song-nospans` (testo semplice nel `<pre>`), `song-nostrum` (senza ritmo/BPM).

Valori comuni a tutte le varianti:

- titolo `Città di Carta`, artista `Gruppo Immaginario`, difficoltà `Beginner`, accordatura `E A D G B E`, capo `0`, key `null`
- sezioni (nome: righe): Intro:1, Verse 1:4, Chorus:2, Verse 2:3, Chorus:2, Outro:1
- 34 accordi in totale; distinti in ordine `Am F C G`
- 4 accordi con `mark: "*"` (G in Intro, G in Verse 1, C nei due Chorus), in 4 righe
- Il Chorus compare due volte con contenuto identico
- Verse 1 contiene una riga di soli spazi (non diventa una riga) e un blocco pubblicitario annidato nel `<pre>` (contiene la parola `ADVERTISEMENTMARKER`, che non deve comparire nel brano)
- righe strumentali (lyric vuoto): Intro (1), Verse 1 (1, la `G` finale), Outro (1)
- ritmo (tutte tranne `song-nostrum`): `Verse 1` 70 bpm 16 celle, `Chorus` 104 bpm 8 celle, `Verse 2 onwards` 128 bpm 8 celle; `song.bpm === 70`. Le celle pari (indice 0, 2, ...) hanno `onBeat: true`. Primo pattern: `D D D - D - D - D - D - - - - -`
- `song-nostrum`: `strumming: []`, `bpm: null`
- `importInfo.method`: `spans`, tranne `song-nospans` (`text-fallback`)
