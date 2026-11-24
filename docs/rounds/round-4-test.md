# Round 4 — Tester: audio sincronizzato (M6) e verifica finale

Leggi `CLAUDE.md`, `docs/SPEC.md` (Audio sincronizzato, milestone 6), `docs/DECISIONS.md`, `docs/rounds/round-4-impl.md` e `docs/reports/round-4-impl.md`. Verifica in modo **indipendente e scettico**. Regole come ai round precedenti.

Questo è l'ultimo round: oltre all'audio fai una **regressione completa** di tutte le milestone.

## A. Correzioni del round 3
1. iPhone 13 a scala 1,5: righe intere in play ≥ 5 in almeno 8 posizioni su 9 (stessa misura del round 3). iPhone SE: riporta i numeri.
2. Numero del tasto nei diagrammi piccoli leggibile (≥ 10 px), il tuo test passa senza `todo`.
3. Etichette distinte nel dialogo "Sostituisci" con copie dello stesso giorno.
4. Reimport conserva transpose, capo e showShapes.
5. Validazione import JSON: i tuoi casi (`timeSignature [300000,4]`, transpose/capo/beats/BPM fuori range) rifiutati con errore e senza blocchi; i 2 test `todo` passano.
6. Selettore capotasto 0–12.
7. Diagrammi per aug, add9, m9 su tutte le radici, musicalmente giusti (riusa la tua verifica delle note).
8. Gli script e2e vecchi aggiornati girano.

## B. Audio: traccia sintetica tua
Genera **tu** con ffmpeg una traccia diversa da quella dell'implementatore (non riusare il suo script per l'atteso): brano di 3–4 sezioni con BPM diversi (es. 70, 96, 142), un silenzio iniziale non tondo (es. 2,345 s), un tono di frequenza diversa a ogni cambio d'accordo, e almeno una battuta di pausa. Fai sia WAV sia MP3 (`-codec:a libmp3lame`), in `test-artifacts/round-4/`. Crea il brano corrispondente (JSON da importare o fixture .mht).

1. Carica audio (WAV e MP3), durata mostrata corretta. L'audio sopravvive a un reload (IndexedDB).
2. Offset: impostalo con il pulsante "Primo accordo!" in un istante sbagliato di proposito (+120 ms), poi correggilo con la regolazione fine fino al valore giusto.
3. **Precisione (criterio M6)**: per ogni cambio d'accordo misura lo scarto tra il cambio dell'evidenziazione (`window.__gapp`) e l'istante atteso nell'audio. Al 100% e al 75%: errore medio e massimo, obiettivo massimo < 100 ms per tutta la durata. Con un BPM sbagliato di proposito (+1 BPM su una sezione) verifica che il suggerimento lo rilevi tramite le ancore e che, applicato, l'errore torni sotto i 100 ms.
4. `preservesPitch` attivo con velocità < 100% (leggi la proprietà dell'elemento; verifica anche che il `playbackRate` sia quello scelto).
5. Tocco su un accordo → l'audio salta lì (`currentTime` = startSec ± 20 ms).
6. Loop di sezione sull'audio: almeno 2 giri, rientro all'inizio della sezione entro 100 ms.
7. Metronomo sopra l'audio: clic intercettati allineati alla griglia, nessun clic doppio dopo seek, pausa e cambio velocità.
8. Battute di pausa: aggiunta, modifica, eliminazione; il conteggio resta allineato.
9. Calibrazione latenza: lo slider sposta l'evidenziazione della quantità impostata (misura con +200 ms); il valore è per dispositivo (vale per tutti i brani).
10. Export JSON: contiene i metadati audio ma non il blob; dopo l'import su storage pulito compare "Audio mancante"; ricaricando lo stesso file si conservano offset e ancore.
11. Eliminando il brano si elimina anche l'audio da IndexedDB.

## C. Regressione completa
Rilancia tutto: `npm test`, i tuoi script e2e dei round 1–3. Poi rileggi i criteri delle milestone 1–6 di `docs/SPEC.md` uno per uno e per ciascuno dai un esito finale **PASSA / FALLISCE / VERIFICABILE SOLO SU TELEFONO** con evidenza. Questa tabella è la cosa più importante del report: servirà all'utente per decidere se la v1 è pronta.

## D. Prova "da utente"
Senza script: apri l'app emulando un iPhone 13 e percorri il flusso completo come lo farebbe un chitarrista alla prima volta, guardando gli screenshot a ogni passo:
1. libreria vuota;
2. import del file reale;
3. lettura;
4. trasposizione e capotasto;
5. play con metronomo;
6. correzione di qualche durata;
7. caricamento audio e sincronizzazione.

Annota ogni punto in cui ti sei bloccato o non hai capito cosa fare: testo poco chiaro, pulsanti nascosti, passaggi non ovvi.

## Report: `docs/reports/round-4-test.md`
Formato dei round precedenti, più la tabella finale delle milestone e la sezione "Prova da utente". Risposta finale di 20 righe al massimo.
