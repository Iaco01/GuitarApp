# Round 9 — Report del tester

Verifica indipendente del round 9 (verdi affidabili, tempo libero, gap in play, decodifica a pezzi, memoria e testi). Nessun testo del brano reale è riportato: solo conteggi, tempi, nomi di sezione e di accordi. Ho misurato prima di leggere i numeri dell'implementatore (che ho letto solo per i confronti). Le varianti audio del brano reale e i file mp3 di prova stanno solo in `test-artifacts/round-9/` (non versionati); gli screenshot (`test-artifacts/round-9/`, `shots/`, `user/`) mostrano il testo e non vanno committati; li ho guardati (SE e 320 px, correzione a 35 accordi, gap in play).

Script nuovi (tutti in `test/e2e/`):

| file | contenuto |
|---|---|
| `round9-tester-variants.mjs` | A: 30 varianti ffmpeg dell'mp3 reale (e rumore rosa sommato in Node), riconoscimento, colori, gap, errore dei cambi rispetto all'originale |
| `round9-tester-realcut.mjs` | A/B: il brano reale tagliato alla fine (40–95%) o privato di una sezione di mezzo |
| `round9-tester-engine.mjs` (`cut`, `missing`, `intro`, `free`) | B1–B4 con semi nuovi (61, 73, 88, 101, 127; banco libero 41, 52, 67) |
| `round9-tester-intro30.mjs` | intro estranea da 20 a 60 s |
| `round9-tester-assets.mjs` | audio sintetico per i test nell'app (gap 2/6/20 s, sezione tolta, taglio al 70%, prefissi di silenzio 40/200/400 s, rumore) |
| `round9-tester-app.cjs` (`gap`, `gap2`, `skip`, `persist`, `sync`, `forced`, `lock`, `variants`, `badfile`, `corr`) | C, D3, E1–E4 nell'app |
| `round9-tester-decode.cjs` | D1/D2: decodifica a pezzi contro decodifica intera, nello stesso browser |
| `round9-tester-user.cjs` | F2: prova da utente su SE e 13 con l'mp3 reale |
| `test/regression/round9-tester.test.js` | 3 test `todo` per i difetti aperti (1, 2, 3) |

## Esito

| Punto | Esito |
|---|---|
| A il brano reale non va rifiutato | **OK: mai rifiutato in 33 varianti realistiche** (64 kbps … rumore rosa a −12 dB); rifiuto solo a −15 dB. Ma il reale tagliato al 40% o 60% **è rifiutato** (bug 2) |
| A regola di riconoscimento | rossi **OR** match (non AND): riconosciuto se rossi < 75% **oppure** match ≥ 0,12; sensata |
| B1 tagli 40–95% (35 tagli, 5 semi nuovi) | 0 verdi sbagliati, 0 sezioni saltate a torto (155 sezioni verdi) |
| B2 sezioni mancanti nel mezzo | sintetico OK (salto giusto 20/20); assolo al posto di una sezione: gap spezzato (bug 3). **Sul reale, una sezione tolta dal mezzo dà un verde sbagliato (bug 1)** |
| B3 intro estranea 5/15/30 s e intro come il Verse | primo evento entro 0,02 s in 25/25; 20–60 s idem |
| B4 tempo libero | giallo 87,4% entro 250 ms (≥ 75 ✓), mai verde ✓, Spearman −0,42 ✓; rosso 54,0% (richiesto < 50, bug 6) |
| C gap in play | OK: nessuna evidenziazione, «Fuori dal foglio», conto alla rovescia, ripartenza a tempo (scarto ≤ 0,09 s), gap < 3 s fusi, pausa/seek/ripresa, persistenza, export/import |
| C sezioni saltate | il play le salta; ma il long-press sull'intestazione di una saltata accende un loop a vuoto (bug 4) |
| D1/D2 decodifica a pezzi | sfasamento ≤ 1 campione (0,09 ms), durata +6/+21 ms, nessun clic ai confini, nessun crash; solo i file senza intestazione Xing/LAME non usano i pezzi (nota) |
| D3 sincronia in play a 2,7 / 5,4 / 8,7 minuti | scarto 20–90 ms su 12 cambi |
| E1–E4 interfaccia | «Usa comunque», blocco BPM, testi a 320/360/SE/13 OK; correzione a 35 accordi: «Salva» sotto il bordo (bug 5) |
| E5 prestazioni ×4 | totale 9,8 / 9,8 / 11,3 s; frame più lungo 86 / 77 / 88 ms; 0 frame > 100 ms; «Annulla» 251 / 364 / 299 ms; picco RSS +84 / +78 / +88 MB |
| F1 regressione | vedi sezione F |
| F2 prova da utente (SE e 13) | completata senza blocchi; testi poco chiari in fondo |

## A. Il brano reale non deve essere rifiutato

Metodo: ogni variante è decodificata con ffmpeg (mono, 44,1 kHz) e passata a `analyseAndAlign` in Node (stesso motore dell'app); il rumore rosa (Paul Kellet) è sommato a SNR dato sul segnale decodificato. In più, 6 varianti sono passate anche dall'app (iPhone SE, decodifica del browser a 11 kHz): tutte riconosciute (vedi sotto). «Entro 250 ms» è il confronto con i tempi dell'originale (spostati dove la variante taglia o ritarda: −10 s, +5 s, ÷1,03), perché sul reale non c'è una verità: serve a trovare i verdi che si spostano.

| variante | riconosciuto | `match` | sezioni verdi / gialle / rosse | rossi/sezioni | gap ≥ 3 s | saltate | analisi (Node) | primo evento (s) | verdi sbagliati |
|---|---|---|---|---|---|---|---|---|---|
| originale | sì | 0,122 | 6 / 3 / 3 | 0,25 | 1 | 0 | 2,0 s | 0,3 | – |
| 64 kbps | sì | 0,123 | 5 / 4 / 3 | 0,25 | 1 | 0 | 2,1 s | 0,3 | – |
| 320 kbps | sì | 0,122 | 6 / 3 / 3 | 0,25 | 1 | 0 | 1,8 s | 0,3 | – |
| mono 22 kHz 64 kbps | sì | 0,122 | 6 / 3 / 3 | 0,25 | 1 | 0 | 1,7 s | 0,3 | – |
| mono 16 kHz 32 kbps | sì | 0,122 | 6 / 3 / 3 | 0,25 | 1 | 0 | 2,0 s | 0,3 | – |
| volume −12 dB | sì | 0,122 | 6 / 3 / 3 | 0,25 | 1 | 0 | 1,8 s | 0,3 | – |
| primi 10 s tagliati | sì | 0,118 | 6 / 3 / 3 | 0,25 | 2 | 0 | 2,2 s | 4,8 | – |
| 5 s di silenzio iniziale | sì | 0,123 | 6 / 4 / 2 | 0,17 | 1 | 0 | 2,0 s | 5,3 | – |
| telefono 300–3400 Hz | sì | **0,069** | 4 / 4 / 4 | 0,33 | 2 | 0 | 1,9 s | **43,1** | – |
| telefono 500–2500 Hz | sì | **0,048** | 2 / 6 / 4 | 0,33 | 2 | 0 | 1,9 s | 43,1 | – |
| riverbero `aecho` | sì | 0,122 | 5 / 4 / 3 | 0,25 | 2 | 0 | 1,8 s | 0,3 | **sezione 2: 2/16** |
| rumore rosa 10 dB | sì | 0,153 | 4 / 4 / 4 | 0,33 | 2 | 0 | 2,0 s | 0,3 | – |
| rumore rosa 0 dB | sì | 0,211 | 2 / 5 / 5 | 0,42 | 1 | 0 | 1,9 s | 0,4 | – |
| rumore rosa −5 / −7 / −10 dB | sì | 0,202 / 0,190 / 0,151 | 1/4/7 · 1/3/8 · 0/2/10 | 0,58 / 0,67 / 0,83 | 2 / 1 / 1 | 0 | 1,9–2,2 s | 1,5 / 14,0 / 24,7 | – |
| rumore rosa −12 dB | sì (solo per `match`) | 0,127 | 0 / 0 / 12 | 1,00 | 1 | 0 | 1,8 s | 12,7 | – |
| rumore rosa −15 dB | **no** | 0,002 | 0 / 0 / 12 | 1,00 | 0 | 0 | 2,0 s | 44,3 | – |
| velocità ×1,03 (`atempo`) | sì | 0,118 | 5 / 4 / 3 | 0,25 | 1 | 0 | 1,7 s | 0,3 | – |
| intonazione +1 semitono | sì | 0,111 (trasposizione 1) | 4 / 5 / 3 | 0,25 | 2 | 0 | 2,5 s | 0,3 | – |
| m4a/AAC | sì | 0,122 | 6 / 3 / 3 | 0,25 | 1 | 0 | 1,4 s | 0,3 | – |
| ogg | sì | 0,120 | 6 / 3 / 3 | 0,25 | 1 | 0 | 2,1 s | 0,3 | – |
| wav | sì | 0,122 | 6 / 3 / 3 | 0,25 | 1 | 0 | 1,7 s | 0,3 | – |
| telefono + rumore 10 / 0 / −5 dB | sì | 0,105 / 0,168 / 0,167 | 3/5/4 · 1/5/6 · 0/3/9 | 0,33 / 0,50 / 0,75 | 1–2 | 0 | 1,7–1,8 s | 43,1 / 12,3 / 12,5 | – |
| telefono 500–2500 + rumore 5 / 0 / −5 dB | sì | 0,116 / 0,152 / 0,177 | 0/6/6 · 0/4/8 · 0/1/11 | 0,50 / 0,67 / 0,92 | 0–1 | 0 | 1,9–2,1 s | 33,7 / 25,3 / 43,1 | – |
| telefono + riverbero + rumore 0 dB | sì | 0,162 | 0 / 3 / 9 | 0,75 | 2 | 0 | 1,8 s | 33,8 | – |
| telefono + intonazione + rumore 0 dB | sì | 0,165 | 1 / 6 / 5 | 0,42 | 1 | 0 | 1,7 s | 43,0 | – |
| riverbero + rumore 0 dB / intonazione + rumore 0 dB | sì | 0,194 / 0,203 | 1/5/6 · 1/6/5 | 0,50 / 0,42 | 0–1 | 0 | 2,0–2,1 s | 4,0 / 12,3 | – |

**Nessun rifiuto in un caso realistico.** Il solo rifiuto è a rumore rosa −15 dB (musica inudibile). Non ho trovato un caso in cui «Usa comunque» sia necessario per il brano giusto tra quelli elencati nel compito.

**AND o OR.** `alignmentRecognised` (src/alignment.js) è un **OR**: il brano è riconosciuto se la quota di sezioni rosse è < 75% (con la condizione sulle saltate) **oppure**, se è ≥ 75%, il `match` della trasposizione è ≥ 0,12. Quindi un `match` basso non rifiuta un allineamento con pochi rossi, e un rosso alto non rifiuta se il `match` è chiaro. La regola ha senso (un solo segnale cattivo non basta), e va letta insieme al fatto che il `match` del reale (0,122) sta a 0,002 dalla soglia: oggi **non decide mai** sul reale perché la quota di rossi è 0,25. Il rischio c'è solo se un file ha ≥ 75% di rossi **e** `match` < 0,12: l'ho cercato con sovrapposizioni di degradazioni (telefono 500–2500 Hz + rumore −5 dB: rossi 0,92, `match` 0,177; telefono + riverbero + rumore 0 dB: 0,75, 0,162) e il rumore alza il `match` (0,05–0,12 senza rumore, 0,15–0,21 con). Non c'è un caso realistico con rossi ≥ 75% e `match` < 0,12. Margine: se il reale fosse registrato con 8 sezioni su 12 rosse, il `match` 0,12 sarebbe il solo giudice: è troppo vicino, ma non è un rischio oggi.

**Cose notate sulle varianti:**
- Telefono (passa-banda): riconosciuto, ma il **primo evento cade a 43 s** (la vera partenza è 0,3 s) con le prime due sezioni rosse: la sincronizzazione è sbagliata dove è rossa, e giusta dove è verde (verdi: 64/64 entro 250 ms). È corretto che il colore lo dica; l'utente deve correggere a orecchio.
- Riverbero: una sezione verde (la 2) ha 2 cambi su 16 sbagliati (12,5%), poco sopra il 10%. Unico verde sbagliato di tutte le varianti.
- Rumore rosa −10 dB: «riconosciuto» con 10 sezioni rosse su 12 e primo evento a 24,7 s: l'utente vede un riepilogo quasi tutto rosso (non c'è più il rifiuto): coerente con «mai gialle da forzatura».
- Nell'app (6 varianti, SE): riconosciute telefono, +1 semitono, 64 kbps, taglio 10 s, ogg, m4a (decodifica 1,2–1,5 s, analisi 1,8–2,3 s); stessi colori e numero di gap del Node (±1 sezione sui gialli: `ryygygygggrr` contro `rgygygygggrr` a 64 kbps).

**Reale tagliato e privato di una sezione (`round9-tester-realcut.mjs`).** Confronto con i tempi dell'analisi del file intero:

| caso | riconosciuto | colori (intero: `rgygygygggrr`) | saltate a torto | verdi sbagliati | sezioni assenti non segnate "saltata" |
|---|---|---|---|---|---|
| tagliato al 40% | **no** | `rgrrrrryrrrr` | 0 | 0 | 6–12 (rosse) |
| tagliato al 60% | **no** | `rrrgrrryrrry` | 0 | 0 | 9–12 (rosse) |
| tagliato all'80% | sì | `rgygygygggrs` | 0 | 0 | – |
| tagliato al 95% | sì | `rgygygygggrg` | 0 | 0 | – |
| senza sezione 5 | sì | `rgyyrgygggrr` | 0 | **sezione 6: 12/16** | 5 |
| senza sezione 7 | sì | `rgygyyrgggrr` | 0 | 0 | 7 |
| senza sezioni 4–5 | sì | `rgygyrrgygrr` | 0 | 0 | 4, 5 |

Sul reale il motore **non riconosce la sezione tolta** (con il sintetico sì: 20 su 20): le durate del foglio sono stimate dal testo, e il controllo di tempo non si applica. Vedi bug 1 e 2.

## B. Correzioni del round 8

**B1 tagli** (`round9-tester-engine.mjs cut`, semi 61, 73, 88, 101, 127 × tagli 40, 50, 60, 70, 80, 90, 95%): 35 tagli, 155 sezioni verdi: **0 verdi sbagliati** (sezione verde con più del 10% dei cambi udibili sbagliati di > 250 ms; round 8: 6 su 25) e **0 sezioni saltate a torto** (presenti nell'audio con ≥ 2 eventi e marcate "non presente"). Colori tipici: taglio 40% `gggsssss`, 50% `gggrssss`, 70% `gggrgyss`, 95% `gggrgggg`.

**B2 sezioni mancanti nel mezzo** (5 semi; i cambi rimasti sono confrontati con la verità spostata):

| caso | saltate trovate | a torto | mancate | cambi rimasti entro 250 ms | gap |
|---|---|---|---|---|---|
| senza Bridge (6) | [6] 5/5 | 0 | 0 | 90,6–96,2% | nessuno |
| senza Verse 2 (5) | [5] 5/5 | 0 | 0 | 90,6–94,3% | nessuno |
| senza Verse 2 e Bridge | [5, 6] 5/5 | 0 | 0 | 88,9–93,3% | nessuno |
| senza Chorus 1 e Verse 2 | [3, 5] 5/5 | 0 | 0 | 88,9–95,6% | nessuno |
| **Bridge sostituito da un assolo di 20 s** | **nessuna** (la sezione 6 resta rossa) | 0 | **5/5** | 90,6–94,3% | **due pezzi** (es. 96,6–105,2 e 111,8–116,7, vero 96,7–116,7): coprono 13,5 s su 20 |

Il salto e il gap si distinguono quando manca soltanto la sezione (salto, nessun gap). Quando al suo posto c'è musica estranea il motore non fa né l'uno né l'altro: la sezione resta rossa e il gap è spezzato dalla parte che la sezione rossa si è mangiata (bug 3, bassa: i cambi intorno restano giusti al 90–95%, la sezione è rossa, l'assolo si sente come "fuori dal foglio" solo per due pezzi).

**B3 intro estranea** (5 semi, il primo accordo vero è a 0,3 s + intro): errore del primo evento

| intro | errore |
|---|---|
| estranea 5 s / 15 s / 30 s | −0,00…+0,02 s in 15/15, confidenza 1,00, nessun gap iniziale |
| con gli stessi accordi del Verse, 15 s / 30 s | +0,01 s in 10/10 |
| estranea 20 / 25 / 45 / 60 s e identica al Verse (2 semi) | +0,00…+0,02 s in 20/20, sezione 1 verde, 0/7 cambi sbagliati |

(Una prima corsa mi dava −3,8 s e −6 s a 30 s: era un mio errore, l'intro generata era più corta di 30 s; corretto con un controllo nel generatore. Il bug 3 del round 8 è risolto.)

**B4 tempo libero** (banco nuovo: arpeggio con prima nota in comune con l'accordo precedente, rubato, accordi tenuti 8 battiti, voce sola con accordi rari; 4 banchi × 3 semi = 24 sezioni, 153 cambi, tutte senza battito stabile secondo il motore):

| colore | sezioni | cambi | entro 250 ms |
|---|---|---|---|
| verde | 0 | – | – |
| giallo | 17 | 103 | **87,4%** (≥ 75 ✓) |
| rosso | 7 | 50 | **54,0%** (richiesto < 50: ✗, bug 6) |

Per banco: rubato 6 sezioni gialle, 100%; accordi tenuti 6 gialle, 60–100%; voce sola con accordi rari 4 gialle (60–80%) + 2 rosse (40%); arpeggio con prima nota in comune 5 rosse (50–63%) + 1 gialla (88%). Correlazione di rango tra confidenza ed errore sui cambi del tempo libero (153): **−0,420** (negativa = buona). Mai verde: ✓. Il rosso è giusto al 54%: pessimista (la metà dei cambi rossi è comunque giusta), non pericoloso.

## C. Gap e sezioni saltate in play

Brano sintetico (seme 91), iPhone SE, gap tra Intro/Chorus/Free e Verse 2 a 80,9 s (6 e 20 s di musica estranea).

| prova | gap 6 s | gap 20 s |
|---|---|---|
| trovato (vero 80,9–86,9 / 80,9–100,9) | 80,9–86,9 | 80,9–100,9 |
| G2 nel gap: nessun accordo evidenziato, «Fuori dal foglio» | 31 campioni, 31 giusti | 122, 122 |
| G3 conto alla rovescia «Riprende tra N s con «Am»» | N = tempo restante arrotondato per eccesso (scarto −1,01…−0,06 s tra rimanente e mostrato) | −1,00…−0,02 s |
| G4 prima e dopo il gap evidenziato | sì (12 / 38 campioni) | sì (12 / 37) |
| G5 dopo il gap i 5 cambi successivi scattano a tempo | scarti 0,02 0,08 0,03 0,05 0,04 s | 0,05 0,08 0,03 0,02 0,06 s |
| G6 pausa dentro il gap | «Fuori dal foglio», stato in pausa | idem |
| G7 seek dentro il gap in pausa | il conto alla rovescia si aggiorna | idem |
| G8 ripresa dentro il gap | in play, ancora «Fuori dal foglio» | idem |
| G9 seek negli ultimi 0,5 s del gap | dopo 1,8 s è evidenziato un accordo | idem |
| G10 seek all'inizio | evidenziazione normale | idem |

Il conto alla rovescia mostra il tempo restante **arrotondato per eccesso** (sempre fra 0 e 1 s sopra): l'errore richiesto < 0,5 s vale solo per l'arrotondamento alla riga intera, non è misurabile con un numero intero; è la scelta normale di un conto alla rovescia, non un difetto.

- **Gap < 3 s** (musica estranea di 2 s inserita): nessun gap salvato, nessuna riga nel riepilogo, durante i 2 s resta evidenziato un accordo (22 campioni, accordi «E» e «Am»), mai «Fuori dal foglio»: fuso con l'accordo precedente.
- **Sezioni saltate** (`nobridge.mp3`, `cut70.mp3`): riepilogo giusto (sezione 6 sola; sezioni 7–8), la riga saltata non ha pulsanti ▶ né ✎ (non si può né ascoltare né correggere), durante il play l'evidenziazione non si ferma mai su un accordo saltato (eventi visti 39,40,49…52; 40,41,−1), nessun errore di pagina. In «Correggi a orecchio» su una sezione saltata non succede nulla perché il pulsante non c'è: è sensato, ma se il motore salta a torto una sezione l'utente non ha come rimetterla (nei miei test non è mai successo: 0 su 35 + 5 + 7).
- **Bug 4**: pressione lunga sull'intestazione di una sezione saltata: l'app accende il loop («Loop attivo: tocca per uscire») senza che ci sia musica da ripetere: con il taglio al 70% resta **ferma** con il loop acceso (screenshot `skip-cut70-SE-longpress.png`; premendo Play parte dall'inizio, con il loop ancora indicato); con la sezione tolta dal mezzo parte dopo la sezione saltata. Nessun errore.
- **Persistenza** (gap 20 s; sezione tolta): identico dopo il ricaricamento (gap e saltate), la riga del gap è ancora nel riepilogo, dopo il ricaricamento il play nel gap dice «Fuori dal foglio», l'esportazione contiene i gap e le saltate, l'importazione in un contesto vuoto dà lo stesso allineamento. 10 controlli, tutti verdi.

## D. Decodifica MP3 a pezzi

Metodo: `src/ui/audiodecode.js` è caricato come modulo ES in Chromium (server http locale) e `decodeForAnalysis` (a pezzi) è confrontato con la decodifica intera dello stesso file nello stesso browser, mix mono, 11,025 kHz. Sorgente: 138 s sintetici, 4 pezzi da 45 s. Misura dello sfasamento: correlazione incrociata su finestre di 0,5 s subito dopo ogni confine (±40 campioni).

| file | pezzi usati | durata a pezzi − intera | sfasamento ai confini (campioni @ 11 kHz) | differenza relativa RMS (dopo correzione dello sfasamento; confini / metà pezzo) | clic ai confini (salto massimo, pezzi/intera) |
|---|---|---|---|---|---|
| CBR 44,1 kHz stereo | sì | +6 ms | 0, −1, −1, −1 (≤ 0,09 ms) | 0,051 / 0,031 | 0,112 / 0,098 |
| CBR 48 kHz | sì | +21 ms | 0, 0, 0, 0 | 0,040 / 0,024 | 0,111 / 0,091 |
| VBR (q2) | sì | +6 ms | 0, −1, −1, −1 | 0,051 / 0,030 | 0,110 / 0,101 |
| mono 44,1 kHz | sì | +6 ms | 0, −1, −1, −1 | 0,051 | 0,148 / 0,130 |
| mono 22,05 kHz | sì | +7 ms | 0, −1, 0, 0 | 0,102 / 0,061 | 0,166 / 0,140 |
| ID3v2 con copertina da 1,4 MB | sì | +6 ms | 0, −1, −1, −1 | 0,051 | 0,112 / 0,098 |
| ID3v1 in coda | sì | +6 ms | 0, −1, −1, −1 | 0,051 | idem |
| intestazione Xing/LAME (predefinita di ffmpeg) | sì | +6 ms | come sopra | come sopra | come sopra |
| senza Xing/LAME | sì (4 chiamate a `decodeAudioData`) | 0 | 0 | 0,000 | – |
| troncato a metà frame | sì | 0 (762 347 campioni = intera) | 0, −1 | 0,062 | 0,112 / 0,098 |
| ADTS/AAC rinominato .mp3 | no (intero) | 0 | 0 | 0,000 | – |
| ogg / wav rinominati .mp3 | no (intero) | 0 | 0 | 0,000 | – |
| byte casuali / testo con estensione .mp3 | – | – | – | – | errore di decodifica (identico a quello della decodifica intera) |

Differenza massima di campione: 0,03–0,13 (fondo scala 1,0), dovuta allo sfasamento frazionario di mezzo campione (il pezzo è posizionato con un'approssimazione di 1 campione = 0,09 ms; la differenza RMS scende da 0,25 a 0,03–0,05 togliendo lo sfasamento). **Nessuno sfasamento oltre 1 campione, nessun clic ai confini** (il salto massimo vicino ai confini è uguale o minore di quello della decodifica intera), durata giusta, nessun crash. Nell'app i file non decodificabili danno l'errore di decodifica (vedi sotto) senza errore di pagina.

Nota: avevo sospettato che i file senza Xing/LAME ripiegassero sulla decodifica intera (risultato identico alla intera); il conteggio delle chiamate a `decodeAudioData` (4, come per gli altri) mostra che i pezzi sono usati: nessun difetto.

**D3 sincronia in play dopo la decodifica a pezzi.** Brano sintetico con prefisso di silenzio da 40, 200 e 400 s (mp3 da 2,9 / 5,4 / 8,6 MB), analisi nell'app; poi play dal vivo: per 4 cambi (8, 24, 41, 56) misuro l'istante in cui l'evidenziazione passa all'accordo giusto (orologio audio) contro la verità.

| prefisso | analisi nell'app | primo evento | cambi entro 250 ms (tutti) | scarto dell'evidenziazione dal vivo (4 cambi) | tempo audio dell'ultimo cambio |
|---|---|---|---|---|---|
| 40 s | 1,5 s | +0,04 s | 56/61 (i 5 fuori sono del tempo libero) | 0,04 0,04 0,09 0,06 s | 163 s (2,7 min) |
| 200 s | 2,0 s | +0,02 s | 56/61 | 0,02 0,07 0,08 0,06 s | 323 s (5,4 min) |
| 400 s | 3,0 s | +0,04 s | 57/61 | 0,02 0,04 0,06 0,09 s | 523 s (8,7 min) |

Nessuna deriva con la posizione (il pezzo a 8,7 minuti è preciso quanto quello a 2,7). Sul reale (8,6 min) il confronto con la decodifica intera di ffmpeg l'ha fatto l'implementatore (`round9-decode-check.cjs`); le mie 6 varianti dell'app dànno gli stessi colori del Node.

**File non decodificabili nell'app** (`badfile`, SE): byte casuali e testo con estensione .mp3 sono rifiutati alla scelta del file con «Questo browser non riesce a leggere «…». Prova con un mp3, m4a o wav.»; wav/ogg rinominati, troncato a metà frame, senza Xing, copertina da 1,4 MB, mono 22 kHz: riepilogo pronto in 0,5–1,0 s. 8/8 senza errori di pagina.

## E. Interfaccia e prestazioni

**E1 «Usa comunque»** (SE, `forced`): rumore rosa, altro brano, silenzio → non riconosciuti, «Usa comunque» offerto; forzato → nessuna sezione verde (stati `rrrrrrrr`, `rsssssss`, `rrrrrrrr`), confidenza massima 0,10 / 0,55 / 0,28 (< 0,75), `forced = true`; il testo della barra: «Allineamento tenuto comunque: nessuna sezione è segnata come sicura. Ascolta e controlla ogni sezione.»; «Scarta» rimuove l'allineamento (nessun allineamento salvato). 21/21 controlli verdi.

**E2 tap tempo e campo numerico** (SE, `lock`): senza allineamento i sei controlli (−, +, due «Tap tempo», «Applica», campo) sono attivi, «+» passa da 90 a 91, la nota fissa è nascosta; con allineamento tutti e sei disattivati e la nota visibile; 12 clic forzati su entrambi i tap tempo non cambiano nessun BPM; dopo «Scarta» tornano tutti attivi. 8/8.

**E3 testi** (`round8-tester-app.cjs sync` su 320, 360, SE, 13): righe 54 px su 12 su tutti e quattro (a 320 px erano 54–71 px nel round 8), nessun testo troncato né fuori schermo (0 elementi, nessun overflow del documento), pulsanti 44 px (24 su 24), «Fatto» in vista a ogni posizione di scorrimento. Screenshot guardati: `test-artifacts/round-9/shots/texts-320-rows.png` e `texts-SE-rows.png`: nome, orario, stato e BPM («sicura · 100,9 BPM», «controlla · 141,4 BPM», «incerta · libero») sono tutti interi e il BPM è visibile su ogni riga.

**E4 correzione con 35 accordi** (reale, SE e 13): le istruzioni non sono coperte da «Cambio!» (stato sopra il pulsante di 10 px; «Cambio!» 351×187 px a y 358 su SE, 366×186 su 13); «Prossimo: C · mancano 31 tocchi» al 4º tocco (screenshot guardato); plurale «mancano 35 tocchi» all'inizio. Singolare e plurale (`corr`): «mancano 35 tocchi» → «mancano 2 tocchi» → «manca 1 tocco» → «Tocchi completi: ascolta l’anteprima e salva»; dopo «Annulla ultimo tocco» torna «manca 1 tocco / 34 / 35 cambi». **Bug 5**: a 35 tocchi completati (con `corr`: Anteprima finisce a y 699 e Salva a y 751 su 667) «Salva» sta a y 671 su SE (schermo 667) e y 670 su 13 (schermo 664): sotto il bordo, bisogna far scorrere la schermata per trovarlo, mentre il testo dice «Fatto: ascolta l'anteprima e poi salva».

**E5 prestazioni** (iPhone SE 375×667, CPU ×4, mp3 reale 513,6 s, nessun altro processo attivo; `round8-tester-app.cjs perf` e `mem`, il mio metodo):

| | corsa 1 | corsa 2 | corsa 3 | obiettivo |
|---|---|---|---|---|
| totale (click → riepilogo) | 9,8 s | 9,8 s | 11,3 s | < 12 s ✓ |
| decodifica + analisi (dall'app) | 1,8 + 7,4 s | 1,7 + 8,0 s | 1,8 + 9,4 s | |
| frame più lungo | 86 ms | 77 ms | 88 ms | < 150 ms ✓ |
| frame > 100 ms | 0 | 0 | 0 | |
| compiti lunghi (massimo) | 2 (77 ms) | 2 (57 ms) | 3 (79 ms) | |
| «Annulla» (dal click al ritorno) | 251 ms | 364 ms | 299 ms | < 400 ms ✓ |
| picco RSS (somma dei processi Chromium) | +84 MB | +78 MB | +88 MB | ≥ −30% (round 8: +403/+425) ✓ |
| picco JS heap | 6 MB | 8 MB | 8 MB | |

**E6 CPU ×6** (una corsa, informativa): 16,2 s totali, frame più lungo 131 ms, 1 frame > 100 ms, 0 > 250 ms, «Annulla» 435 ms, 9 compiti lunghi (massimo 116 ms), heap 8 MB. Resta accettabile; l'«Annulla» supera di poco i 400 ms.

## F. Regressione e prova da utente

**F1.** `npm test`: 222/222 verdi. `bash test/e2e/round9-regress.sh` (build fresco, tutti gli e2e dei round 4–8 e i miei del round 7–8, più `round9-decode-check`): tutti verdi, 0 FAIL, tranne `round7-tester-app synth`, che ha l'unico FAIL già dichiarato dall'implementatore (C3c, evidenziazione dal vivo nel tempo libero, media 275 ms, punto debole noto; C6b non più eseguibile perché «+» è disattivato). Decode-check: 326/328 eventi entro 100 ms, massimo 185 ms. Gli e2e del round 9 dell'implementatore (`round9.cjs`) non li ho rilanciati: ho scritto i miei equivalenti (sopra). I miei script: gap, gap2, skip, persist, sync, forced, lock, variants, badfile, corr tutti verdi (salvo i `FAIL` che non ci sono); `test/regression/round9-tester.test.js`: 3 `todo`.

**F2 prova da utente** (SE e 13, solo tocchi, mp3 reale): importazione, sincronizzazione in 3,4 s, riepilogo `rgygygygggrr` (6 sicure, 3 da controllare, 3 incerte), correzione della sezione rossa 1 (35 accordi, 35 tocchi sull'orologio audio), salvataggio (riga «verificata»: «6 sicure · 3 da controllare · 2 incerte · 1 verificate a orecchio»), Accetta, Fatto, Play. Dal secondo 56 si passa nel gap 0:59–1:03: 16–17 campioni dentro, nessun accordo evidenziato, pannello «Fuori dal foglio» e «Riprende tra 4 / 3 / 2 / 1 s con «G»», prima e dopo l'accordo è evidenziato; screenshot `user/SE-08-play-gap1.png` guardato. Nessun errore di pagina, totale 73 s.

Cosa non è chiaro nei testi:
- «libero» («incerta · libero») non si capisce senza spiegazione: è il «tempo libero»; e la riga dice «controlla» mentre legenda e conteggi dicono «da controllare».
- La prima sezione del reale è rossa e il pulsante primario la manda a una correzione da 35 tocchi: per un brano di cui l'utente vede il Verse 1 è un lavoro lungo e il motivo del rosso non è spiegato.
- «parte non presente nel foglio» per 0:59–1:03 non dice cosa fare, e a 4 s è una pausa o un passaggio, non una "parte".
- Nel gap il pannello mostra «≈153,7» BPM e il foglio resta in cima alla pagina (non scorre al punto): chi guarda lo schermo non vede dove si è.
- Dopo i tocchi la schermata dice di ascoltare l'anteprima e salvare, ma i due pulsanti sono fuori schermo (bug 5).

## Bug

| # | gravità | descrizione |
|---|---|---|
| 1 | media | **Reale con una sezione di mezzo tolta** (come una versione "single"): la sezione tolta non è segnata «non presente» e quella che segue è **verde con 12 cambi su 16 sbagliati** (da 0,6 a 4,2 s, rispetto all'analisi del file intero); la sezione prima si comprime di 2,8–9 s (gialla). Col sintetico lo stesso caso funziona (20/20). Causa probabile: durate del foglio stimate dal testo, controllo di coerenza del tempo disattivato. `todo` in `test/regression/round9-tester.test.js` |
| 2 | media | **Reale tagliato al 40% o 60%**: «audio non riconosciuto» (7–10 sezioni su 12 rosse, `match` sotto 0,12) e le sezioni dopo il taglio sono rosse invece di «non presente nell'audio»; all'80% e 95% va. «Usa comunque» c'è. `todo` |
| 3 | bassa | Sezione sostituita da un assolo di 20 s (5 semi): non è «saltata» (resta rossa) e il gap è spezzato in due pezzi (13,5 s su 20). I cambi intorno restano giusti al 90–95%. `todo` |
| 4 | bassa | Pressione lunga sull'intestazione di una sezione saltata: si accende il loop senza musica da ripetere (con il taglio al 70% l'app resta ferma col loop indicato; Play riparte dall'inizio). |
| 5 | bassa | Correzione con 35 accordi su SE e 13: a tocchi completi «Anteprima» e «Salva» stanno sotto il bordo (Salva a y 671 su schermo 667 / 670 su 664). |
| 6 | bassa | Tempo libero: il rosso è giusto al 54,0% sul mio banco (richiesto < 50%): 5 sezioni con arpeggio a nota comune sono rosse con 50–63% di cambi giusti. Pessimista, non pericoloso. |
| 7 | cosmetico | Testi: «libero» e «controlla» / «da controllare» (vedi F2). |

Non sono bug: conto alla rovescia arrotondato per eccesso (scarto 0–1 s); una riga saltata non ha ✎ (nei miei test nessuna sezione è mai stata saltata a torto: 0 su 35 tagli sintetici, 5 sezioni tolte, 7 prove sul reale); i file senza Xing/LAME usano i pezzi.

## Verdetto

**Round 9 accettabile, nessun bloccante.** Il brano reale non è mai rifiutato in 33 varianti realistiche (compresi telefono, rumore rosa a −12 dB, +1 semitono, ×1,03); la regola è un OR, con `match` del reale a 0,122 che oggi non decide mai (rossi 25%). Verdi sbagliati: 0 su 155 sezioni verdi in 35 tagli e 5 semi; intro estranea risolta; gap in play, persistenza e decodifica a pezzi (≤ 0,09 ms, nessun clic) giusti; prestazioni ×4: 9,8–11,3 s, frame max 88 ms, «Annulla» ≤ 364 ms, +78–88 MB. Restano due casi del reale (bug 1 e 2: sezione tolta dal mezzo, audio tagliato al 40–60%) dove la sincronizzazione è sbagliata o rifiutata; il bug 1 è l'unico con un verde sbagliato.

## Non verificato

- Nessuna verità sul reale: i confronti sono con l'analisi del file intero, non con l'ascolto.
- iOS reale, microfono, rumore musicale (solo bianco/rosa).
- Un assolo vero al posto di una sezione del reale (solo sintetico).
