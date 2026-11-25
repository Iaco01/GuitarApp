# Accordi a tempo

Web app statica per telefono: importa una pagina Ultimate Guitar salvata come file `.mht`, la mostra in modo leggibile (accordi colorati sopra la sillaba giusta) e la suona a tempo, anche sincronizzata con l'audio del brano. Zero dipendenze, nessuna rete a runtime: tutto resta nel browser del telefono.

## Funzioni

- **Importazione** di una pagina Ultimate Guitar salvata (.mht): titolo, artista, difficoltà, accordatura, capotasto, sezioni, accordi sopra la sillaba giusta, ritmo (strumming) e BPM per sezione.
- **Lettura**: accordi colorati, scala del testo (A−/A+), tema chiaro/scuro, ritornelli uguali compressi; scala e tema sono ricordati per brano.
- **Suonare a tempo**: Play con conteggio, accordo corrente evidenziato, pannello con accordo, "Poi" con battiti mancanti, pallini del battito, BPM e ritmo; metronomo (clic), velocità 50–100%, tap tempo, diagrammi nel pannello, salto toccando un accordo, loop di sezione (pressione lunga sull'intestazione), schermo sempre acceso (Wake Lock dove c'è).
- **Durate**: all'import (e per i brani già in libreria) le durate sono stimate da dove cade ogni accordo sulle sillabe del testo; si possono tornare a durate fisse 2/4/8, correggere accordo per accordo, copiare sui ritornelli uguali, aggiungere battute di pausa, registrare a tap. **BPM** per sezione e, durante il play, controllo − / + nel pannello (pressione prolungata = ripetizione, tocco sul numero = campo e tap tempo) su tutto il brano in proporzione o solo sulla sezione corrente, senza far saltare la posizione.
- **Trasposizione** ±12 semitoni, **capotasto** 0–12 con suggerimento di 3 opzioni, diagrammi di tutti gli accordi (anche forme del capotasto).
- **Libreria**: ricerca, ordinamento, esportazione e importazione JSON (dell'audio si esportano solo i metadati), badge "durate" e "audio" (o "audio mancante" se il file non è nel browser).
- **Audio sincronizzato**: carichi un file audio (resta nel telefono, in IndexedDB), fissi l'inizio con «Primo accordo!», segni facoltativamente l'inizio delle sezioni (⚓ ancore, regolabili a ±10/±50 ms) e la fine del brano; l'app scala i tempi tra due ancore e suggerisce di correggere i BPM. Calibrazione della latenza per cuffie Bluetooth.
- **Sincronizzazione automatica (round 7)**: con l'audio caricato, «Sincronizza automaticamente» decodifica l'mp3 sul telefono e allinea la sequenza di accordi del foglio sull'audio (inizio, tempo, cambio di ogni accordo, anche a tempo libero). Riepilogo per sezione con colore di fiducia (verde / giallo / rosso), «Ascolta e controlla», trasposizione trovata, «Correggi a orecchio» (tocchi «Cambio!» a ogni cambio mentre l'audio gira: la sezione diventa verificata), esportazione delle sezioni verificate in JSON (solo tempi e nomi degli accordi) e «Usa durate e BPM misurati» per studiare col metronomo. La sincronizzazione manuale resta come ripiego.

## Build

```
npm run build        # produce dist/index.html (un solo file, CSS e JS inline)
```

Apri `dist/index.html` direttamente (`file://`) o da un server statico. Per sviluppare, servi la cartella con un server statico (es. `python3 -m http.server`) e apri `index.html`: i moduli ES non si caricano da `file://`.

Struttura: moduli ES in `src/` (i moduli puri girano anche in Node), `scripts/build.mjs` li unisce. Le regole dei moduli sono in `CLAUDE.md`.

## Test

```
npm test             # node --test "test/*.test.js" (unit test, senza browser)
npm run fixtures     # rigenera test/fixtures/synthetic/*.mht (testo inventato)
```

Il test sul file reale (`test/fixtures/local/american-pie.mht`, fuori da git perché contiene testo protetto) viene saltato se il file manca.

### Script end-to-end (Playwright, a mano)

Servono `npm run build` e, per l'audio, le tracce sintetiche in `test-artifacts/` (ffmpeg):

```
node test/fixtures/make-audio.mjs && node test/e2e/round4-tester-make.mjs
node test/e2e/ui-round1.cjs          # lettura, allineamento accordi, nessuna sovrapposizione (file reale)
node test/e2e/round2.cjs             # player e metronomo
node test/e2e/round3.cjs             # trasposizione, capotasto, diagrammi, libreria
node test/e2e/round3-panel.cjs       # pannello di riproduzione
node test/e2e/round4.cjs             # audio sincronizzato di punta a punta
node test/e2e/round4-tester-audio.cjs [B1|B3|...]   # precisione dell'evidenziazione sull'audio
node test/e2e/round4-tester-anchors.cjs             # ancore nelle intestazioni
node test/e2e/round5.cjs             # round 5: sincronizzazione, pannello, libreria, ancore
node test/e2e/round5-text.cjs        # spaziatura del testo sotto gli accordi (file reale)
node test/e2e/round6.cjs             # round 6: durate stimate, − / + del BPM in play (file reale e audio sintetico)
node test/e2e/round7-panel.cjs       # round 7: riga del ritmo nel pannello (a ogni frame, altezza)
node test/e2e/round7.cjs [flow|perf|all] [360|SE|13]   # round 7: sincronizzazione automatica sull'mp3 reale, correzione a orecchio, CPU ×4
node test/e2e/autosync-real.mjs [--truth correzioni.json]   # motore sul brano reale (ffmpeg); con le correzioni esportate dall'app dà l'errore vero
node test/e2e/autosync-bench.mjs     # banco sintetico lungo (verità nota)
```

Screenshot e numeri vanno in `test-artifacts/` (ignorato da git).

## Usarla sul telefono

L'app è pubblicata su **https://iaco01.github.io/GuitarApp/** tramite GitHub Pages: a ogni push su `main` la GitHub Action `.github/workflows/pages.yml` esegue i test, fa la build e pubblica `dist/index.html`.

1. Apri https://iaco01.github.io/GuitarApp/ nel browser del telefono (Chrome su Android, Safari su iOS). Funziona offline dopo il primo caricamento se il browser la tiene in cache; i dati (brani, audio) restano nel browser: usa «Esporta libreria» per un backup.
2. Aggiungi alla schermata Home dal menu del browser per averla a schermo intero.
3. Importa il file `.mht` con «Importa .mht»; per l'audio apri il brano e tocca «Aggiungi audio».
4. Sincronizzazione automatica: nella schermata «Sincronizza audio» tocca «Sincronizza automaticamente» e tieni lo schermo acceso (circa 20–30 s su un telefono recente, decodifica compresa; barra di avanzamento e «Annulla»). Poi «Ascolta e controlla» e correggi le sezioni gialle o rosse con «Correggi a orecchio». Per esportare le tue correzioni (un file `.json` con solo tempi e nomi degli accordi) usa «Esporta correzioni».

## Come salvare una pagina Ultimate Guitar

- **Chrome per computer** (modo sicuro oggi): apri il brano, menu ⋮ → Salva, stampa e condividi → Salva pagina come, formato «Pagina web, singolo file (.mht)». Poi passa il file al telefono e importalo dall'app.
- **Chrome Android / Safari iOS**: il salvataggio MHTML può non essere disponibile; se lo è, salva la pagina e importa il file con «Importa .mht».
