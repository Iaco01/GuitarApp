# Report round 5 — tester (verifica delle correzioni e verdetto v1)

Verifica indipendente su `dist/index.html` (build di HEAD `4a85fca`, 246.648 byte, 30 moduli) e sul file reale. Per il file reale solo conteggi, nomi di sezione e nomi di accordi: nessun testo del brano in file versionati o nel report. Screenshot in `test-artifacts/round-5/tester/` (non versionati), guardati con lo strumento Read: schermata di sincronizzazione (SE, 13, 320×568; caricata, in play, dopo "Primo accordo!", foglio dell'ancora), brano dopo la sincronizzazione, pannello con loop e clic (SE, 13), etichette tagliate a 360 px scala 2,0.

Nessun file di `src/`, `scripts/` o test esistenti toccato. `npm test`: **160/160**. Ho solo corretto un'asserzione fragile del mio `round4-tester-audio.cjs` (B3W, vedi sotto).

## Script miei nuovi (a mano, non in `npm test`)

- `node test/e2e/round5-tester-core.mjs` — Node, atteso calcolato qui da battiti e BPM: bug 1 sul file reale (−0,5 / −3 / +2 %, più un caso con ancore su 3 tratti), soglia del suggerimento, timeline tra ancore (scansione ogni 10 ms). ALL PASSED.
- `node test/e2e/round5-tester-browser.cjs [S1|S2|S3|S4|S5|REAL]` — browser: bug 1 su traccia sintetica con ancore su ogni sezione, soglia nell'interfaccia, `window.__gapp` a ogni frame (rAF), coda non rilevata, ancore/badge/"Primo accordo!" con pausa, percorso reale con un WAV silenzioso. ALL PASSED.
- `node test/e2e/round5-tester-text.cjs [360|SE|13]` — controllo mio della spaziatura sul file reale: testo di ogni riga del DOM uguale al testo del parser, etichetta sopra il carattere della sua colonna, larghezza delle righe, scroll.
- `node test/e2e/round5-tester-ui.cjs [SE|13|320]` — barra della sincronizzazione, loop (pressione lunga vera, CDP touch) e clic, misure e screenshot.
- Rilanciati i miei del round 4: `round4-tester-audio.cjs` (tutto), `round4-tester-anchors.cjs`, `round4-tester-a.cjs`.

## A. Bug del round 4

| Bug | Esito | Evidenza |
| --- | --- | --- |
| 1 (grave) file reale | CORRETTO | Node, atteso mio: offset 3 s, "Fine brano" con la durata −0,5 %: **un solo suggerimento (sezioni 1–12), Applica → 62,3 / 96,5 / 142,7** (prima tutte 108,5), errore a fine brano **3 ms**, rapporti conservati entro 0,04 %, nessun secondo suggerimento. Stessa cosa a −3 % (63,9/99/146,4, errore −66 ms su 722 s: è l'arrotondamento a 0,1 BPM) e +2 % (53 ms). Con ancore su 3 tratti (+1 %, −1,5 %): 3 suggerimenti con fattori distinti, tutti applicabili, poi nessuno. **Nel browser** (percorso dell'utente: "Primo accordo!" a 3 s, "Fine brano", Applica, con un WAV silenzioso) stesso risultato: «Tra Verse 1 e Chorus l’audio va il 0,5% più veloce: da +0,3 a +0,7 BPM circa su ogni sezione.», tempi 62,3/96,5/142,7, fine timeline a 3 ms. |
| 1 traccia sintetica, +1 BPM su una sola sezione, ancore su ogni sezione | CORRETTO | Ancore esatte su Strofa, Ponte, Finale + "Fine brano". **Finale a 97**: un suggerimento «Nella sezione Finale l’audio va il 1% più lento: −1 BPM circa», Applica → errore **0 ms** su 22 eventi. **Strofa a 97** e **Ponte a 143**: nessun suggerimento (errore sotto soglia) e **0 ms** perché le ancore assorbono il tempo. Con ancore toccate "a mano" (il mio B3W: tocco 83 ms in ritardo sul Finale) l'errore finale è **max 91 ms** (media 67): sotto 100 ma con poco margine, perché l'imprecisione del tocco si spalma sul tratto Intro–Ponte (36→78 ms). Round 4: 76 ms. È il costo di un tocco impreciso, non un difetto. |
| 2 tocco in ritardo | CORRETTO | 78 ms: nessun suggerimento (Node e interfaccia). **Soglia minima: 150–151 ms** (misurata su Finale, Ponte e Strofa; nell'interfaccia 148 ms no, 152 ms sì). Sensata: sopra l'errore tipico di un tocco (50–100 ms) e sotto la deriva che si sente; un errore di tempo reale di 0,75 BPM (0,78 %) su una sezione di 20 s si rileva. Due note: (a) sotto soglia l'errore sulla coda dopo l'ultima ancora può arrivare a ~150 ms, oltre il criterio M6 di 100 ms: Finale a 96,7 invece di 96 (0,7 %) → nessun suggerimento, ultimo evento **−127 ms**; (b) oltre soglia un tocco molto tardivo (≥152 ms) genera **due suggerimenti di segno opposto** («va il 0,7% più lento… » e «…più veloce») che incolpano l'audio: se si applicano entrambi si torna quasi al punto di partenza. Entrambe rifiniture. |
| 4 vuoti e salti | CORRETTO | `window.__gapp.player.eventIndex` e `.ch.cur` del DOM a ogni frame (≈1450 frame fino al Finale, 2450 su tutto il brano) con Strofa a 100, Strofa a 92, Intro a 80, ancore su ogni sezione: **vuoto tra sezioni 0,00 ms, 0 salti, 0 ritorni, 0 frame senza evidenziazione**, nessun salto dell'evento al passaggio delle ancore. Il BPM effettivo seguito è mostrato («♩ ≈ 96» con salvato 100, letto in play). Node: scansione ogni 10 ms con 6 varianti (Strofa 100/92/120/70, Intro 90, Finale 110): nessun salto né ritorno, eventi contigui. |
| 3 ancore ⚓ | CORRETTO | `round4-tester-anchors.cjs`: dopo "Fatto" **["⚓ 0:02,4"]**, dopo il reload lo stesso (prima 0 elementi). Con 3 ancore: 4 ⚓ nelle intestazioni. |
| 5 badge audio | CORRETTO | Libreria con il file in IndexedDB: «audio ✓»; dopo import su storage pulito: «**audio mancante**» (B10). |
| 6 "Primo accordo!" con pausa | CORRETTO | Pausa di 4 battiti a inizio brano (pulsante "+ pausa"): tocco a 6,000 s → primo accordo vero a **6,000 s (0,0 ms)**, la pausa parte a 2,571 s. Tocco troppo presto: «Troppo presto: prima del primo accordo c’è una pausa più lunga. Riprova più tardi.», offset resta 0 (nessun negativo). |
| 5. Precisione M6 | NON PEGGIORATA | Cambio dell'evidenziazione (`.cur`) contro l'inizio atteso di 22 eventi su 22. **WAV 100 %: media 4,7 ms, max 13,0. WAV 75 %: media 4,5, max 13,1. MP3 100 %: media 6,9, max 15,1. MP3 75 %: media 7,2, max 15,2.** Round 4: max 18–20 ms. Offset con tocco +120 ms e passi ±10/±50: 2341 / 2343 ms (atteso 2345). Clic: scarto 0,0 ms dalla griglia, 0 doppi. Loop: rientro entro 9 ms. Salto su accordo 4 ms. Latenza 200 ms: +208 ms. |

**Modifiche dell'implementatore ai miei script / a `round4.cjs`.** Controllate col diff. `round4-tester-audio.cjs`: la B3W ora cercava il testo nuovo con «−1 BPM circa»; ma il suggerimento reale con un tocco di 83 ms è «1% … −0,9 BPM», quindi l'asserzione falliva (unico FAIL su 47). Misure intatte; ho allargato la regex a −0,5…−1,4 BPM. Aggiunto un controllo B3G (vuoto 0 ms): rafforza. `round4.cjs`: S6 ora si aspetta *nessun* suggerimento per 0,12 s su 5 s (coerente con la soglia) e rimette l'ancora tolta; S8 conta 2 ancore. Non indebolisce le misure di precisione; però il controllo "Applica imposta il BPM della sezione" di S6 è stato tolto da `round4.cjs`: è ora coperto da `round5.cjs` R4 e dai miei S1/REAL (e dal test Node sul file reale).

## B. Interfaccia

| Punto | Esito | Evidenza |
| --- | --- | --- |
| B1 spaziatura del testo (file reale, 360 / SE / 13, scala 1,0 e 2,0) | CORRETTO | Mio controllo indipendente, 137 righe, 326 etichette: **testo di ogni riga identico a quello del parser (0 differenze: nessuno spazio aggiunto o perso)**, 0 righe a una sola riga più larghe dei loro caratteri di oltre 1 px, **etichette tutte entro 1 carattere dalla colonna** (max 1,00), 0 scroll orizzontale in tutti e 6 i casi. Il loro script `round5-text.cjs` lo conferma: 0 righe con spazi in più su 135, 0 sovrapposizioni su 328 etichette. |
| B1 etichette "Em" a 360 px scala 2,0 | CONFERMATO, LIEVE | 4 etichette (le 4 «Em» a fine riga) sporgono di **4,7 px** oltre il bordo; l'etichetta è larga 50,7 px con bordo e margine interno, quindi viene tagliato il bordo destro del riquadro, **le lettere restano intere e leggibili** (screenshot). A 360 px e 2,0 (scala massima su uno schermo molto stretto) non disturba; a 1,0 e su SE/13 non succede. |
| B2 barra fissa, SE 375×667 | CORRETTO | Altezza **123 px su 667 (18,4 %)**, 215 px con «⋯» aperto (32 %). "Primo accordo!" e "⚓ Inizio: <sezione>" **56 px**, affiancati, interamente nello schermo appena caricato l'audio, senza scorrere, e ancora mentre suona. |
| B2 320×568 | ACCETTABILE | 123 px su 568 (**21,7 %**), pulsanti 144×56; i testi vanno a capo su due righe ma restano leggibili. «⋯» aperto 38 %. iPhone 13 (390×664): 18,5 %. |
| B2 note | — | Il messaggio è un foglio sopra la barra e copre per ~5 s metà del riquadro "2. Inizio" (testo che va a capo, non tagliato). Il tasto Play è 53×44 px (gli altri comandi della barra sono ≥ 44): il comando principale a due tocchi sono i due grandi, quindi va bene. |
| B3 indicatori 🔁 e 🔔/🔕 | CORRETTO | Pressione lunga con tocco vero sull'intestazione della Strofa: nel pannello «🔁 Strofa» (84×42 px, 62×42 a 320 px) sempre visibile; tocco = esce dal loop (e l'intestazione perde «× Loop»). Icona del clic 🔕/🔔 (40×40) accanto, visibile senza aprire «⋯»; un tocco la inverte. Riserva piccola: i due bersagli sono 40–42 px, sotto i 44 px consigliati. |
| B4 prova da utente | MIGLIORATA, resta qualche attrito | Vedi sotto. |

### B4 — "Prova da utente" (iPhone SE e iPhone 13 emulati, tema scuro, traccia sintetica), a confronto col round 4

Migliorato:
1. **"Primo accordo!" non è più fuori vista**: la barra in basso lo mostra subito dopo il caricamento (round 4: sotto la piega, su SE invisibile). È il blocco più grave del round 4 e non c'è più.
2. **Messaggi non tagliati** (foglio sopra la barra, vanno a capo), il testo del passo 2 dice «nella barra in basso» e «se il brano comincia con una pausa, conta dal primo accordo vero».
3. **Ancore visibili** dopo "Fatto" e dopo il reload; foglio con −50/−10/+10/+50 e "Chiudi" (prima solo ±0,1 s).
4. **Loop e clic hanno un indizio a schermo**, con uscita a un tocco.
5. Il suggerimento BPM non può più rovinare i tempi (bug 1–2).

Ancora un attrito:
1. La schermata del brano su iPhone SE e 13 **non mostra testo nel primo schermo** (titolo, impostazioni, diagrammi): rinviato dall'implementatore, resta così.
2. «Esporta libreria» disabilitato sembra attivo; C e Am nel tema scuro simili (rinviati, dichiarati).
3. «+ pausa» e «Registra» continuano a non spiegarsi da soli.
4. Con «♩ = 70,1» nel pannello mentre l'intestazione dice «= 70» (tempo effettivo tra ancore, con scarto sotto 0,2): innocuo ma un po' strano.
5. La barra copre circa un quinto dello schermo mentre si scorrono le sezioni (18–22 %), come previsto.

## C. Regressione

- `npm test`: **160/160**.
- Script dell'implementatore: `ui-round1` 75 PASS, `round2` 18, `round3` 24, `round3-panel` senza errori (pannello 112 px a 360 px, 99 px iPhone 13), `round4` ALL PASSED (44), `round5` ALL PASS (66), `round5-text` 6 casi senza sovrapposizioni né scroll. 0 FAIL.
- Miei: `parser-independent` 36 OK, `parser-robustness` 55 OK, `round2-tester-core` 18, `round2-tester-parser-perf` 6, `round3-tester-core` 23, `round3-tester-b` 30, `round3-tester-e` 62, `round4-tester-a` 17, `round4-tester-audio` 46 PASS + 1 FAIL (la regex B3W, ora corretta e non rilanciata per intero: 8 minuti), tutti senza altri FAIL. `round3-tester-regress.mjs` (script del round 2 adattati ai selettori attuali): round2 18/18, ui1 **28/28**, ui2 **24/24**, ui3 26/26, ui4 7/7, ui-round1 75/75 (al round 4: 27/28 e 23/24, ora anche i due FAIL di temporizzazione sono verdi).
- Due FAIL dei miei vecchi script, non regressioni: `round3-tester-d2` «accordi sconosciuti invariati» (atteso troppo stretto: `C13#11b9` ora è riconosciuto e trasposto; `Xzz` resta invariato) e `round3-tester-a` A5 «dopo pausa/play» 0,250–0,414 (transitorio dello scorrimento morbido, lo stesso script lo registra 0,45 nelle misure normali). `round3-tester-a` ha superato il mio tetto di 900 s alla fine di A6 (iPhone 13 a 1,5: **5 righe intere in tutte e 9 le posizioni**; la parte iPhone SE non è stata raggiunta, ultimo valore del round 4: 2–6 righe). Gli script `round2-tester-ui1..4` lanciati direttamente si fermano sui vecchi selettori, come al round 4.

### Tabella finale delle milestone

| # | Criterio | Esito finale | Evidenza |
| --- | --- | --- | --- |
| 1 | Titolo, artista, Beginner, E A D G B E, capo 0 | PASSA | `real-fixture.test.js`, `parser-independent.mjs` |
| 1 | 12 sezioni (6 strofe, 6 ritornelli), 328 accordi, 6 distinti G D Em Am C A, 62 BPM | PASSA | stessi test + `round3-tester-b` (30 PASS) |
| 1 | Test automatici con `node --test` | PASSA | 160/160 |
| 2 | Si legge sul telefono senza zoom | PASSA in emulazione / VERIFICABILE SOLO SU TELEFONO | 360, SE, 13: 0 scroll orizzontale, testo del DOM identico al parser |
| 2 | Accordo sopra la sillaba giusta anche a capo | PASSA | mio controllo: 326/326 etichette entro 1 carattere, 0 sovrapposizioni, 0 spazi in più (prima 37–42 righe con spazi in più) |
| 2 | A−/A+ e tema chiaro/scuro | PASSA | `ui-round1`, `round3-tester-a` |
| 3 | Metronomo a tempo per 5 minuti senza scarti udibili | PASSA (orologio) / VERIFICABILE SOLO SU TELEFONO (udibile) | round 2; clic sulla griglia 0,0 ms |
| 3 | Evidenziazione esattamente sul battito previsto | PASSA | max 13–15 ms (22/22 eventi, 100 % e 75 %, WAV e MP3) |
| 3 | Prossimo accordo e battiti mancanti sempre visibili | **PASSA** (era "con riserva") | nessun vuoto tra ancore: 0 frame senza accordo, 0 salti; tempo effettivo mostrato |
| 3 | Lo schermo non si spegne | VERIFICABILE SOLO SU TELEFONO | Wake Lock simulato: richiesto/rilasciato; avviso se non supportato |
| 4 | Correzione + / −, copia sui ritornelli uguali, tap | PASSA | `round2-tester-ui3` 26/26, `round3-tester-a` |
| 4 | Durate salvate dopo la chiusura | PASSA | reload: durate, pause, `timingSource` conservati |
| 5 | Trasposizione ±12 che torna all'originale | PASSA | `round3-tester-core` (38896 casi) |
| 5 | Suggerimento capotasto con 3 opzioni | PASSA | `round3-tester-b` sul file reale; selettore libero 0–12 |
| 5 | Diagrammi per i 6 accordi | PASSA | in ogni trasposizione; 572/572 forme giuste |
| 5 | Libreria con ricerca, esportazione e importazione JSON | PASSA | `round3-tester-e` 62 PASS; badge audio corretto |
| 6 | Entro 100 ms dal cambio reale per tutta la durata, dopo offset e BPM | **PASSA** (era FALLISCE) | max 13–15 ms con offset e BPM giusti; con BPM sbagliato di +1 e ancore a mano 91 ms; sul file reale −0,5 %: fine a 3 ms. Limite: una deriva sotto 150 ms (0,3 %) non viene segnalata e può dare ~127 ms in coda dopo l'ultima ancora |
| 6 | Salto toccando un accordo | PASSA | 4 ms |
| 6 | Velocità al 75 % senza cambio di intonazione | PASSA (proprietà) / VERIFICABILE SOLO SU TELEFONO (orecchio, Safari) | `preservesPitch` true, rate 0,75 |
| 6 | Calibrazione con cuffie Bluetooth | VERIFICABILE SOLO SU TELEFONO | meccanica verificata: 200 ms spostano l'evidenziazione di +208 ms, valore per dispositivo |

## Bug e osservazioni residue (nessuno bloccante)

1. **MINORE — Soglia 150 ms contro criterio 100 ms.** Una deriva di tempo fino a 150 ms (o 0,3 %) non produce suggerimento; dopo l'ultima ancora la timeline usa i BPM salvati, quindi un ultimo tratto lungo con tempo sbagliato di 0,7 % finisce a −127 ms. Si rimedia con un'ancora sull'ultima sezione e "Fine brano" (poi eventuale suggerimento), ma l'interfaccia non lo dice. Non ho aggiunto un test `todo`: è un compromesso di progetto.
2. **MINORE — Due suggerimenti di segno opposto** quando un'ancora è toccata ≥ 152 ms fuori; il testo accusa l'audio. Chi applica solo il primo peggiora, chi applica entrambi torna al punto di partenza.
3. **MINORE — L'imprecisione di un tocco si spalma** sull'intero tratto tra le ancore vicine (83 ms di ritardo → fino a 78 ms sul Ponte). Ora si corregge a passi di 10 ms dal foglio dell'ancora.
4. **COSMETICO** — «♩ = 70,1» nel pannello contro «= 70» nell'intestazione; bersagli 🔁 e 🔔 di 40–42 px; 4 «Em» tagliate di 4,7 px a 360 px scala 2,0 (solo il bordo); il foglio dei messaggi copre per 5 s parte del passo 2.
5. Rinviati e dichiarati: nessun testo nel primo schermo del brano, «Esporta libreria» disabilitato che sembra attivo, C/Am simili nel tema scuro, «+ pausa»/«Registra» da spiegare, caug a 5 dita, registratore a tap che non suona l'audio.

## Verdetto

**Sì: la v1 è pronta per la prova sul telefono vero.** Il bug grave del round 4 (suggerimento che appiattiva i tempi) è corretto e verificato sul file reale e nel browser; gli altri cinque problemi sono corretti; la precisione dell'evidenziazione non è peggiorata (max 13–15 ms); la spaziatura del testo è risolta (0 righe con spazi in più); la schermata di sincronizzazione ora è usabile a una mano. Quel che resta sono rifiniture.

**Da provare a mano sul telefono (non verificabile qui):**
1. Wake Lock: lo schermo resta acceso durante 5 minuti di play (Safari iOS e Chrome Android) e l'avviso compare se non è supportato.
2. Intonazione al 75 % (`preservesPitch`) all'orecchio, soprattutto su Safari.
3. Clic e audio insieme con cuffie Bluetooth: la calibrazione della latenza basta? Il clic arriva a tempo con l'audio sull'uscita Bluetooth?
4. Con la tua registrazione vera: "Primo accordo!" a orecchio, ancore sulle sezioni, "Fine brano" e un "Applica" sensato (fattore di pochi per mille); l'evidenziazione resta sul brano a metà e alla fine, in particolare dopo l'ultima ancora.
5. Importare il `.mht` vero salvato da Safari iOS e da Chrome Android (come lo salva il telefono, non il computer) e rileggere il testo a distanza di braccio, all'aperto, con scala 1,0–1,5.
6. Pressione lunga per il loop, tocco su 🔔 e su un accordo con il telefono in mano; dimensione dei bersagli da 40 px.
7. Persistenza: chiudere e riaprire il browser, ritrovare durate, ancore e audio (IndexedDB può essere svuotato da iOS dopo giorni di inattività: verificare che compaia «audio mancante» e che "Ricarica audio" conservi offset e ancore).
8. Leggibilità del tema scuro (C e Am simili) e della barra fissa (circa un quinto dello schermo) in uso reale.
