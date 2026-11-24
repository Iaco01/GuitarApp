# Report round 4 (implementatore): audio sincronizzato

## Fatto
- **Correzioni dal round 3** (tutte e 8): schermi bassi (< 700 px: diagrammi piccoli spenti, attivabili da "⋯ → Diagrammi"; avviso schermo chiuso non torna), numero del tasto leggibile nei diagrammi piccoli ("5fr" sotto), etichette "Sostituisci" con data e ora e "(copia N)", reimport che conserva transpose/capo/showShapes, validazione import (timeSignature, transpose, capo, beats, BPM) con i 3 `todo` ora test normali (`test/round3-fixes.test.js`), selettore capotasto 0–12, forme aug/add9/m9 (+ Dadd9, Fadd9 aperti), script `ui-round1.cjs` e `round2.cjs` aggiornati (tutti PASS).
- **Audio** (M6): `src/audiosync.js` (puro: ancore, suggerimenti BPM, conversione tempo media → tempo contesto, nucleo dei clic, loop, confronto file), `buildTimeline` con ancore, `src/audio.js` (player su `<audio>`: clock = `currentTime − latenza`, `playbackRate` con `preservesPitch`, salto, loop, clic sopra l'audio), `src/audiostore.js` (IndexedDB `gapp-audio/files`), schermata "Sincronizza audio" (carica/sostituisci/elimina, "Primo accordo!" + −50/−10/+10/+50, "Ascolta da qui" con clic, ancore di sezione con ⚓ nelle intestazioni, "Fine brano", BPM ±0,5 per sezione, suggerimenti con "Applica"), calibrazione della latenza (anche dalla libreria), battute di pausa ("+ pausa"), audio mancante dopo import, eliminazione brano ⇒ eliminazione audio, MB in IndexedDB in libreria.
- Traccia sintetica: `test/fixtures/make-audio.mjs` (WAV esatto in JS + mp3 con ffmpeg solo nei test; output in `test-artifacts/audio/`, non in git).

## Verifiche
- `npm test`: **154 test, 154 ok** (erano 127); `npm run build` ok: **dist/index.html 235.0 KB circa (29 moduli)**.
- Playwright (`test/e2e/round4.cjs`, 45 controlli, tutti PASS, Pixel 7 a 360 px, `--autoplay-policy=no-user-gesture-required`). Scarto tra evidenziazione e inizio reale del tono (12 cambi accordo, 3 sezioni a 120/90/150 BPM, offset impostato da UI con tocco + regolazione fine):
  - **100%: da +9 a +11 ms; 75%: da +5 a +20 ms** (obiettivo 100 ms). Con tracce a BPM diverso e ancore: da +2 a +13 ms.
  - Misura indipendente nel grafo audio (ScriptProcessor sull'elemento, stesso orologio del contesto): l'evidenziazione precede i campioni di 6–11 ms.
  - Con latenza 180 ms l'evidenziazione è spostata di 185–197 ms, come voluto.
- Salto toccando un accordo (in play, indietro, da pausa), loop (2 giri in 14 s, tempo sempre dentro la sezione), clic sopra l'audio regolari (0,500 s a 120 BPM), 10 seek ravvicinati e 5 seek subito dopo la programmazione di un clic: 0 clic "vecchi", 5/5 annullati; nessun clic in pausa; `preservesPitch` impostato e `playbackRate` 0,75; ancore, suggerimento "La sezione Ponte sembra a 92 BPM (ora 90)", applica, ancora incoerente rifiutata; export/import con audio mancante: stesso file ⇒ nulla da chiedere, file diverso ⇒ domanda sì/no; pause aggiunte/modificate/eliminate.
- Screenshot guardati con Read (`test-artifacts/round-4/`, non versionati): schermata di sincronizzazione (inizio, ancore, suggerimento), calibrazione, brano con ancore.

## Non verificato / limiti
- Nessuna prova su telefono reale, né con cuffie Bluetooth, né su Safari/iOS (il percorso `MediaElementAudioSourceNode` solo al primo uso del clic è pensato per questo ma non provato). Chromium headless ha latenza di uscita 0: la compensazione è verificata sull'orologio, non all'orecchio.
- Il clic sopra l'audio non usa la latenza: ipotesi che audio e clic abbiano lo stesso ritardo di uscita; da controllare a orecchio con la calibrazione ("Ascolta da qui").
- Il registratore a tap non suona l'audio (usa il metronomo con la timeline senza ancore).
- `transpose` accettato in −12…+12 (vedi DECISIONS).
- La barra di trasporto della schermata di sincronizzazione è sticky e copre un po' di contenuto sugli schermi bassi.

## Come provarlo sul telefono
1. Apri l'app (`dist/index.html` o dove l'hai messa) e importa un brano come sempre.
2. Dentro il brano tocca **Aggiungi audio → Carica audio** e scegli l'mp3 (o m4a/wav) della canzone. Il file resta sul telefono.
3. **Fissa l'inizio**: premi Play e, appena senti il primo accordo, tocca il grande **Primo accordo!**. Poi affina con −50 / −10 / +10 / +50 ms e controlla con **Ascolta da qui (con il clic)**: parte 2 secondi prima con il clic acceso.
4. **Ancore (facoltative)**: se il brano cambia tempo o si sfasa, riascolta e tocca **Inizio sezione: …** quando parte ogni sezione. Con **Fine brano** l'app ti suggerisce il BPM giusto ("Le sezioni … sembrano a 141,5 BPM (ora 142)") e basta toccare **Applica**. Puoi anche regolare i BPM di 0,5 alla volta.
5. Premi **Fatto**: ora Play segue l'audio. Tocca un accordo per saltare lì, tieni premuto sull'intestazione di una sezione per il loop, riduci la velocità in "⋯" (l'intonazione non cambia). Il **clic** si accende da "⋯" ed è spento di default.
6. **Cuffie Bluetooth**: da "Calibra la latenza" (schermata di sincronizzazione o libreria) premi "Avvia la prova", guarda il cerchio e ascolta i clic, sposta il cursore finché lampo e suono coincidono, poi Salva. Rifalla ogni volta che cambi cuffie.
7. Intro o assoli senza accordi: "Modifica durate" → "+ pausa" nella sezione, regola i battiti con −/+.
8. Dopo un'importazione della libreria il brano dice "Audio mancante: ricarica …": scegli lo stesso file e inizio e ancore tornano.
