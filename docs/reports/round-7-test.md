# Round 7 — Report del tester

Verifica indipendente della sincronizzazione automatica e delle correzioni del round 6. Nessun testo del brano reale è riportato (solo tempi, nomi di sezione e di accordi, conteggi). Script: `test/e2e/round7-tester-make.mjs` (generatore sintetico mio), `round7-tester-engine.mjs` (B), `round7-tester-core.mjs` e `round7-tester-a.cjs` (A), `round7-tester-app.cjs` e `round7-tester-robust-app.cjs` (B2 e C), `round7-tester-user.cjs` (D). Test dei difetti noti come `todo`: `test/regression/round7-tester.test.js` (fuori da `npm test`: `node --test "test/regression/*.test.js"`). Screenshot in `test-artifacts/round-7/tester/` (non versionati, mostrano il testo).

## Esito

| Punto | Esito |
|---|---|
| A1 ritmo leggibile, cella corrente sempre accesa, altezza pannello | OK (un salto di 20 px all'avvio del Play a 360) |
| A2 limite BPM (fattore, avviso, Annulla senza audio) | OK |
| A3 primi accordi ≥ 2 battiti, levare esclusa | OK |
| A4 − / + ≥ 44 px, "♩=62" | OK |
| B1 precisione sul sintetico | 100% sul tempo stabile, 0–33% sulla sezione a tempo libero (bug 2) |
| B2 robustezza | nessun crash; audio più lungo con musica in più: nessun allineamento (bug 1) |
| B3 determinismo | OK (anche tra processi) |
| C1 flusso, Annulla a metà, riepilogo, Accetta | OK |
| C2 CPU ×4 | 17,7–18,5 s: dentro i 20 s ma con poco margine; frame più lungo 1,2 s |
| C3 evidenziazione che segue i tempi veri | OK sul tempo stabile (media 34 ms), no sul tempo libero (bug 2) |
| C4 Correggi a orecchio (+80 ms, tocco saltato) | funziona; difetti di UX (bug 5) |
| C5 esportazione e `--truth` | OK |
| C6 ancore, BPM −/+, trasposizione | ancore e trasposizione OK; BPM −/+ non fa nulla (bug 3) |
| C7 reload, export/import con allineamento | OK |
| D regressione | verde; due script vecchi falliscono per motivi già presenti (vedi D) |
| D prova da utente SE e 13 | completata senza blocchi; attriti elencati |

## A. Correzioni del round 6

Misure mie (due campionatori indipendenti: `requestAnimationFrame` e intervallo di 7 ms, 8 s di Play sul file reale, 360×740, SE, iPhone 13).

1. **Ritmo**: 16 celle da 19–21 px di larghezza e 16 di altezza (font 14 px), tutte dentro lo schermo, riga non tagliata (`scrollWidth` = `clientWidth`). La cella corrente è accesa in tutti i 482 fotogrammi e in tutti i ~1140 campioni a 7 ms, mai due celle insieme, su tutti e tre gli schermi; la cella si muove (9 cambi in 8 s a 62–96 BPM). Altezza del pannello (round 6 → ora): 360: 112,5 → 116,5 a riposo e 136,5 in Play (riga accesa di default); SE e 13: 99 → 103 a riposo (riga spenta sotto i 700 px di altezza) e 123 con la riga accesa. Il tetto "+24 px" regge. Nota: a 360 il pannello cresce di 20 px nel momento in cui parte il Play (le celle compaiono solo allora), quindi la barra in basso salta (bassa).
2. **Limite BPM**: da 62/96/142 digitando 280 per "tutto il brano" si arriva a 131/202,8/300: fattore unico 2,113 (dispersione 0,0004), nessuna sezione oltre 300. Compaiono la nota "+69 BPM su tutto il brano (limite 30–300: i rapporti restano)" e "Annulla", anche senza audio. Annulla ripristina esattamente tutte le 12 sezioni e nasconde la nota. Un cambio normale non mostra la nota e l'altezza del pannello non cambia. Limite basso (31): 31/48/71/48…, tutte ≥ 30.
3. **Primi accordi**: sul file reale il primo accordo di ogni sezione dura 2 2 4 2 4 2 8 2 4 2 2 2 battiti (nessuno sotto 2). Prova della levare: ho anteposto otto parole di testo prima del primo accordo di ogni sezione (spostando le colonne): nelle sezioni senza righe strumentali le durate sono identiche (0 sezioni cambiate su 10); nelle due con una riga strumentale cambia l'unità media per sillaba, come atteso. Una sezione con un solo accordo dura ≥ 2.
4. **Pulsanti**: − e + misurano 44×44 px su tutti e tre gli schermi; l'etichetta è "♩=62" senza spazio (nel titolo di sezione del testo resta "♩ = 62", è un altro elemento).

Rispetto al round 6, 73 accordi su 328 (in 10 sezioni su 12) hanno durate diverse: è la nuova regola della levare, dichiarata nelle decisioni.

## B. Motore (Node)

**Generatore mio** (`round7-tester-make.mjs`, diverso da quello dell'implementatore): corde pizzicate additive (armoniche con decadimento proprio, strisciata di 12 ms) e non Karplus-Strong, basso su battiti 1 e 3, cassa/rullante/hi-hat, voce finta con vibrato (note non d'accordo), rumore, 8 sezioni (90, 120, 76, **libera**, 120, 132, 80, 100 BPM, 61 accordi, 137 s), registrata **un semitono sopra il foglio** e a **−25 cent** (l'implementatore: +2 e +30), 22,05 kHz mono. La sezione libera ha durate casuali tra 1,4 e 3,8 s e un arpeggio lento (note ogni 0,3–0,5 s) invece della strisciata.

1. **Precisione** (3 semi, 0,8 s di calcolo ciascuno):

| seme | tutti 100 / 250 / 500 ms | tempo stabile (55 eventi) | tempo libero (6 eventi) |
|---|---|---|---|
| 3 | 90,2 / 90,2 / 91,8% | 100 / 100 / 100% | 0 / 0 / 16,7% |
| 11 | 88,5 / 90,2 / 90,2% | 98,2 / 100 / 100% | 0 / 0 / 0% |
| 29 | 93,4 / 93,4 / 93,4% | 100 / 100 / 100% | 33 / 33 / 33% |

 Errore mediano 24–39 ms. Trasposizione +1 trovata in tutti i semi (margine > 2300), sintonia stimata −22 cent contro −25 veri (errore 3 cent, il bias di +6 dell'implementatore sul suo generatore qui non c'è), BPM giusti entro 1 in tutte le sezioni stabili, la sezione libera riconosciuta come `null`. Dopo mp3 a 128 kbps e decodifica nel browser (seme 7): 91,8% a tutte e tre le soglie, errore sul tempo stabile media 34 ms, massimo 59 ms.
 Confronto con la Fase A (97–98%): sul tempo stabile il mio dà il 100%, ma il mio generatore non ha rubato né cambi di tempo dentro le sezioni, quindi è un limite superiore come il loro; la differenza complessiva viene tutta dalla sezione libera (bug 2). Non confrontabile con il 94–100% che loro riportano per il tempo libero (il loro tempo libero non è un arpeggio).
2. **Robustezza** (seme 3; "conf" = confidenza media degli eventi, riferimento 0,99):
 - *Audio più corto* (taglio al 55%): nessun crash; gli eventi presenti nell'audio entro 500 ms 93,3%; i 29 eventi oltre la fine sono compressi nell'ultimo tratto ma con confidenza media 0,16; nell'app: sezioni verde, giallo e poi rosse (`gyrrrryr`), messaggio normale "Sincronizzazione pronta" (non dice che l'audio è più corto).
 - *Audio più lungo*: con una ripetizione della strofa in mezzo e 25 s di coda con altri accordi funziona (70,5% entro 500 ms su tutti, 85,7% sugli eventi dopo la ripetizione). Con silenzio o rumore aggiunto in coda (fino a +70 s) funziona perfettamente. Ma con **musica in più che richiama accordi del foglio** (l'audio ripetuto una volta e mezza, 1,25× e 1,35×, 2×) il motore restituisce `null` e l'app dice "Non sono riuscito ad allineare questo brano all'audio. Usa la sincronizzazione manuale" (bug 1).
 - *Accordo mancante* (3 accordi non suonati): gli altri entro 500 ms 89,7%; i tre mancanti hanno confidenza 0,04 / 0,00 / 0,00. Buono.
 - *Silenzio iniziale di 10 s*: primo evento a 9,8 s (vero 10,0), 90,2% entro 250 ms, come il caso base.
 - *Mono a 22 kHz*, 44,1 kHz e perfino 8 kHz: nessun crash, risultati uguali (90–92%).
 - *Rumore bianco* (150 s): nessun crash, confidenza media 0,47 (contro 0,99), nessuna sezione con BPM stabile, nell'app 8 sezioni rosse. Ma propone "La registrazione è 4 semitoni sopra il foglio" con il pulsante "Trasponi il foglio" (margine 16 contro 2300 dei casi veri; bug 4). Silenzio digitale: tutto rosso, nessuna trasposizione. Audio vuoto o di 0,14 s, campioni NaN: nessuna eccezione (`null` o risultato finito).
3. **Determinismo**: due esecuzioni nello stesso processo, copie dell'ingresso e due processi separati danno lo stesso risultato (SHA-1 identico); il brano in ingresso non viene modificato.

## C. App (Playwright)

1. **Flusso** (mp3 reale, iPhone SE): Annulla a metà (30%) → la pagina risponde dopo 293 ms, frame più lungo 50 ms, messaggio "Sincronizzazione annullata.", nessun allineamento salvato; si rifà senza ricaricare (5,6 s, 328 eventi) → 12 sezioni giallo, giallo, giallo, verde, giallo, verde, giallo, verde, verde, verde, rosso, rosso, un colore per stato (arancio, verde, rosso) e anche scritto a parole ("sicura / da controllare / incerta") → "Accetta" salvato. "Rifai" seguito subito da "Annulla" torna al riepilogo precedente senza perderlo.
2. **CPU ×4** (mp3 reale): 17,7 s totali (decodifica 2,0, analisi 15,4); un secondo run 18,5 s. Frame più lungo 1,15 s, 6 frame oltre 250 ms su 467, 55 long task, massimo 1,13 s: la pagina non è bloccata ma scatta. Annulla sotto ×4: risposta in 426 ms. Margine sui 20 s: ~10% (bug 7).
3. **Play con allineamento** (sintetico via mp3): tempi della timeline contro verità: tempo stabile media 34 ms, massimo 59 ms. Evidenziazione dal vivo (cambio di `eventIndex` rispetto all'orologio audio): eventi 14–18 errori 68, 20, 18, 68, 51 ms. **Sezione libera: errori dal vivo di 14–918 ms** (−787, +811, +699, +779, +14, +918): l'evidenziazione cambia fino a 0,9 s dopo o prima (bug 2). La sezione risulta gialla ("da controllare · tempo libero"), mai verde.
4. **Correggi a orecchio** (sezione di 12 accordi, tocchi con `pointerdown` sull'orologio audio):
 - tocchi +80 ms in ritardo con ritardo di reazione 0: i tempi salvati sono 80 ms in ritardo; con il ritardo impostato a 80 ms (8 pressioni su +) l'errore medio è 18 ms, massimo 23 ms; il valore resta tra le impostazioni del dispositivo (`reactionMs: 80`).
 - un tocco saltato: contatore "11 / 12 cambi", Anteprima e Salva disattivati, ma il testo non cambia e non dice quale accordo manca; l'unico rimedio è "Ricomincia" (si rifà tutta la sezione). Se poi arriva un tocco spurio nella sezione successiva il contatore va a 12/12 e "Salva" è attivo, ma il salvataggio viene rifiutato con "L'ultimo tocco cade dopo l'inizio della sezione successiva": bene. Un tocco spurio *dentro* la sezione sfaserebbe tutto senza avvisi (non rilevabile).
 - anteprima: un solo accordo evidenziato alla volta; "Salva" → sezione "verificata ✓", conteggio "1 verificate", le altre sezioni intatte, l'evento subito dopo la sezione corretta resta al suo posto (errore 0 ms).
5. **Esportazione**: il JSON ha le chiavi `app, kind, version, eventCount, sections[index, name, chords, eventStartSec, verified]` (nessun testo), nome file `correzioni-<titolo>.json`. `autosync-real.mjs --truth` sul file della prova da utente (35 tocchi alternati ±250 ms rispetto al motore) legge e calcola: 0% entro 100 ms, 46% entro 250 ms (i tocchi stanno a 250 ± pochi ms), 100% entro 500 ms, mediano 250 ms: coerente.
6. **Interazioni**: un'ancora sulla sezione 3 prevale sull'allineamento (inizio sezione esattamente sull'ancora, 0,6 s dopo il vero); "Trasponi il foglio" imposta `transpose = 1` e l'allineamento resta. **BPM −/+ con allineamento attivo**: tre pressioni di + cambiano l'etichetta da "♩=90,1" a "♩≈90,1" (il valore misurato), 0 eventi su 61 si muovono, audio e Play intatti; la nota dice "+3 BPM su tutto il brano" con "Annulla", ma non si sente né si vede nulla: i BPM salvati cambiano, l'allineamento no (comportamento dichiarato, ma fuorviante: bug 3).
7. **Persistenza**: dopo il reload l'allineamento è identico (JSON uguale) e il riepilogo ricompare; l'export della libreria contiene l'allineamento e l'import su un contesto pulito dà lo stesso allineamento senza il file audio (la schermata chiede di ricaricarlo). Non ho riverificato l'import con una sezione verificata (lo copre `round7.cjs` per il reload). Una volta (su una prima versione dello script, con `page.goto` su `#/` dopo "Fatto") il renderer è andato in "Target crashed"; non si riproduce in tre prove successive: non lo conto come bug.

## D. Regressione e prova da utente

**Regressione**: `npm test` 197/197; `round4.cjs` 44 PASS ALL PASSED; `round5.cjs all` 66 PASS ALL PASS; `round6.cjs` 25 PASS; `round7-panel.cjs` 9 PASS; `round7.cjs flow` 15 PASS su 360, SE e 13; `round7.cjs perf` PASS (18,3 s a ×4); `round4-tester-a` 17 PASS, `-anchors`, `-audio B1` 15 PASS, `-decode`, `round5-tester-core` 28, `-browser` 25, `-text` 8, `round6-tester-fuzz` 8, `-browser` 60, i miei `round7-tester-a` 39 e `-core` 3: tutti verdi. Due script vecchi falliscono, non per colpa del round 7: `round5-tester-ui.cjs SE` va in timeout sul clic di un "Chiudi" nascosto, e fallisce identico sulla build del round 6 (commit 8e71f1e, rieseguita); `round6-tester-core.mjs` A1 (2 FAIL) confronta le durate con la tabella del report del round 6, che la nuova regola della levare ha cambiato (73 accordi su 328). Non rieseguita la corsa intera di `round4-tester-audio.cjs` (> 10 minuti).

**Prova da utente** (solo tocchi veri con `page.tap` e `touchscreen.tap`, SE 375×667 e iPhone 13 390×664, brano e mp3 reali): dalla libreria vuota al brano importato (0,3 s), "Sincronizza audio", mp3, "Sincronizza automaticamente" (visibile senza scorrere, 325×64 / 340×64), barra con "Annulla" visibile, riepilogo dopo 4,8–7,0 s, "Ascolta e controlla" (mostra "Verse 1 · Em"), "Correggi a orecchio" su Verse 1 (35 accordi) con 35 tocchi sul pulsante "Cambio!" (351×187 px, nessun errore di mira), anteprima, "Salva" → "5 sicure · 4 da controllare · 2 incerte · 1 verificate a orecchio", esportazione, "Accetta", Play con timeline allineata. 74–76 s in tutto, nessun errore di pagina, **nessun punto in cui mi sono bloccato**. Attriti:
- il riepilogo è lungo: 12 righe da 105–122 px (circa 1300–1500 px); "Accetta" sta in alto, "Esporta correzioni" in fondo e "Fatto" in cima non è fisso: dopo l'esportazione servono due schermate di scorrimento per tornare indietro;
- il messaggio a comparsa ("Sincronizzazione pronta…", "«Verse 1» verificata a orecchio") copre per qualche secondo le righe sotto;
- nella schermata di correzione i pulsanti disattivati (Salva con 5/35 tocchi, Anteprima) hanno lo stesso aspetto di quelli attivi: con 5 tocchi su 35 "Salva" è blu pieno (bug 5);
- con 35 accordi la lista di chip mostra solo tre righe (scorre dentro un box di 106 px): il chip successivo è tratteggiato e si segue bene, ma il conteggio "5 / 35 cambi" è l'unico segnale globale;
- dopo "Fatto" il brano si apre in cima (diagrammi e impostazioni): con Play la scheda del testo non è in vista nei primi secondi;
- la riga "Verse 1 · Em" di "Ascolta e controlla" resta scritta anche a musica ferma.

## Bug, per gravità

1. **Media — audio più lungo del foglio con musica in più: nessun allineamento.** Sintetico di 137 s con in coda i primi 34 s ripetuti (1,25×), 1,35× o l'intero brano due volte: `analyseAndAlign` restituisce `null` (l'ultima passata banda di Viterbi non ha percorso, `align.js` riga 174/304/339) e l'app dice di usare la sincronizzazione manuale. Il messaggio è sensato, ma non c'è degradazione: basta una ripetizione finale in più nel disco per perdere tutto. Silenzio, rumore o altri accordi in coda funzionano. Test `todo` in `test/regression/round7-tester.test.js`; nell'app lo riproduce `round7-tester-robust-app.cjs` (caso `longer`).
2. **Media — sezione a tempo libero con arpeggio: eventi spostati di 0,4–0,9 s con confidenza 1,00.** Su tre semi 0–33% entro 250 ms nella sezione libera, mentre il resto sta al 100%; dal vivo l'evidenziazione sbaglia fino a 0,9 s. Attenuante: la sezione esce sempre gialla (declassamento di un gradino per il tempo libero), ma le confidenze per evento (1,00) sono sbagliate e un tratto libero non diventa mai rosso. Riserva: il mio caso è severo (primo suono dell'arpeggio = una sola nota di basso; la sezione libera inizia sullo stesso accordo con cui finisce il ritornello, quindi il confine è invisibile); non so quanto pesi sul brano reale, che ha 3 sezioni libere. Test `todo` in `test/regression/round7-tester.test.js`.
3. **Media-bassa — BPM −/+ con l'allineamento attivo non fa nulla di udibile ma dice di sì.** Etichetta da "=" a "≈", nota "+3 BPM su tutto il brano" con Annulla, 0 eventi spostati su 61. Comportamento dichiarato nei limiti dell'implementatore, ma l'interfaccia lo nasconde: meglio disattivare i tasti o spiegarlo.
4. **Bassa — rumore o audio sbagliato: viene proposta una trasposizione.** Rumore bianco: "La registrazione è 4 semitoni sopra il foglio" + "Trasponi il foglio" (margine 16, contro oltre 2300 nei casi veri); inoltre tutto rosso ma messaggio "Sincronizzazione pronta" e "Accetta" disponibile.
5. **Bassa — UX di "Correggi a orecchio" e pulsanti disattivati.** Non esiste uno stile `:disabled` per `.btn` (Salva, Anteprima, "Togli ultimo tocco", "Esporta correzioni (0)" sembrano attivi); con un tocco saltato nessun testo dice quale accordo manca e l'unica via è "Ricomincia". Test `todo` per lo stile.
6. **Bassa — prestazioni a ×4 con poco margine:** 17,7–18,5 s su 20, frame più lungo 1,15 s (6 frame sopra 250 ms). Un telefono più lento di ×4 supera i 20 s e scatta di più.
7. **Bassa — il pannello cresce di 20 px all'avvio del Play** a 360 px (le celle del ritmo compaiono solo allora): la barra salta.
8. **Cosmetica — schermata di sincronizzazione lunga:** "Fatto" non fisso, messaggio che copre le righe, riga "Verse 1 · Em" residua.

## Non verificato

Dispositivo reale (latenza vera di tocco e di uscita audio, Safari, decodifica a 11025 Hz su iOS); ascolto a orecchio dell'allineamento sul brano reale (nessuna verità: la correttezza vera del 57–59% di controllo locale resta ignota, qui ho solo verificato la meccanica); export/import della libreria con una sezione verificata; corsa completa di `round4-tester-audio.cjs`; "Usa durate e BPM misurati" non provato.
