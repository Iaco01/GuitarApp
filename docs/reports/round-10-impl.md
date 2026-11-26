# Round 10 — Report dell'implementatore

Sezioni tolte o sostituite nel reale, tagli, interfaccia, tempo libero, testi, più due aggiunte dell'utente (un tic per quarto, ritocco fine). Nessun testo del brano reale: solo conteggi, tempi, nomi di sezione. "Prima" = HEAD del round 9 (`8b86705`), "dopo" = HEAD. Decisioni in `docs/DECISIONS.md` ("Round 10"). I tre `todo` del tester sono test normali (`test/round10-real-*.test.js`, `test/round10-engine.test.js`); la cartella `test/regression/` è stata rimossa.

## 1. Reale con una sezione tolta (bug 1)

**Causa del salto mancato.** Saltare una strofa da 36 accordi costava 12·36 = 432; stringerla nei 16 s di ritornello vicino costava meno, perché i tempi locali si adattano alla sezione schiacciata (la penalità di durata sparisce nei passi successivi) e le durate del foglio, stimate dal testo, non lo impedivano. La sezione dopo risultava verde con 12 cambi su 16 sbagliati.

**Cosa fa ora.** Coerenza tra sezioni uguali (stessi accordi: stessi battiti misurati, mediana delle sorelle): una sezione fuori soglia non è mai verde, una molto fuori è rossa, i vicini non sono verdi; una sezione troppo corta è un "sospetto" e si rifà l'allineamento con salto a 2 per accordo solo per lei. Coerenza col battito (cambi lontani dal mezzo battito > 50%: non verde) è una rete di sicurezza: sul reale non discrimina (vedi decisioni).

Tabella (il reale, tolta una sezione dall'audio; per gruppo di sezioni uguali; "eventi fuori" = eventi a più di 250 ms dal tempo atteso sul totale presente):

| caso | prima: colori · verdi sbagliati · tolta segnata | dopo: colori · verdi sbagliati · tolta segnata | eventi fuori prima → dopo |
|---|---|---|---|
| senza sez. 3 | `ryryygygygrr` · 0 · no | `rysgygygygrr` · 0 · sì | 32 → 12 |
| senza sez. 4 | `rgyyygygggrr` · 0 · no | `rgysygygggrr` · 0 · sì | 14 → 6 |
| **senza sez. 5** (il caso del tester) | `rgyyrgygggrr` · **sez. 6: 12/16** · no | `rgygsgygggrr` · 0 · sì | 36 → 5 |
| senza sez. 6 | `rgygyyygygrr` · 0 · no | `rgygysygygrr` · 0 · sì | 16 → 4 |
| senza sez. 7 | `rgygyyrgggrr` · 0 · no | `rgygygsgggrr` · 0 · sì | 26 → 3 |
| senza sez. 9 | `rgygygyrrgrr` · 0 · no | `rgygygygsgrr` · 0 · sì | 46 → 11 |
| senza sez. 4+5 | `rgygyrrgygrr` · 0 · no | `rgygyssgygrr` · 0 · sì (due) | 68 → 68* |
| senza sez. 7+8 | `rgygrrrgggrr` · 0 · no | `rgygyssgggrr` · 0 · sì (due) | 62 → 26* |
| senza sez. 3+9 | `ryryygrrrgrr` · 0 · no | `rrsgygygsgrr` · 0 · sì (due) | 64 → 48* |

\* Con due sezioni tolte l'audio non dice quali: ogni strofa suona come l'altra, quindi il motore segna "non presente" due sezioni dello stesso tipo, non per forza quelle tolte; gli "eventi fuori" contano contro il tempo della sezione originale, quindi restano alti. I test controllano per gruppo di sezioni uguali.

**Reale intero, evento per evento rispetto al round 9:** 328 eventi, **328 entro 250 ms, differenza massima 0,000 s**, nessun salto, un gap, tempo di calcolo 2,2 s (invariato). Colori: `rgygygygggrr` (round 9) → `rgygygygggry`: l'unico cambio è l'ultima sezione, a tempo libero, che con la nuova soglia del tempo libero (punto 5) passa da incerta a da controllare. Nessuna differenza sopra 250 ms da elencare.

Costo: un allineamento in più solo quando c'è un sospetto (≈ +0,5 s in Node); sezione tolta 1,7–2,4 s, due tolte 3–5 s (Node).

## 2. Reale tagliato (bug 2)

Causa: il primo passo parte dall'ipotesi che l'audio copra tutto il foglio; con un audio più corto le sezioni si stringono (e anche la trasposizione può uscire sbagliata). Ora, se il risultato è povero e coprire tutto il foglio richiederebbe > 190 BPM medi, si provano 0,7 / 0,45 / 0,28 del foglio, con raffinamento sulla quota ottenuta e nuova ricerca della trasposizione; si accetta solo se la fine del foglio è saltata. Il riconoscimento conta solo le sezioni non saltate.

| taglio | prima: riconosciuto · colori · eventi fuori | dopo: riconosciuto · colori · eventi fuori |
|---|---|---|
| 30% | no · `rrrrryrrrrrr` · 96/97 | **sì** · `rgygssssssss` · 1/97 |
| 40% | no · `rgrrrrryrrrr` · 112/127 | **sì** · `rgygysssssss` · 0/127 |
| 50% | no · `rrrrrrrrryrr` · 164/164 | **sì** · `rgygygysssss` · 0/164 |
| 60% | no · `rrrgrrryrrry` · 187/202 | **sì** · `rgygygygssss` · 0/202 |
| 80% | sì · `rgygygygggrs` · 38/270 | sì · uguale · 38/270 (sezioni libere rosse che si muovono di > 250 ms fra due analisi) |
| 95% | sì · `rgygygygggrg` · 1/312 | sì · uguale · 1/312 |

Sintetico (35 tagli, 5 semi, `round9-tester-engine.mjs cut`): 155 sezioni verdi, 0 verdi sbagliati, 0 saltate a torto (come prima). Costo: solo nei casi di tempo implausibile; un file rumoroso ma completo (−5 / −12 dB) resta a 2,5 s come prima (senza il filtro dei 190 BPM saliva a 7 s).

## 3. Assolo al posto di una sezione (bug 3)

Salto + gap (costo extra 30 per il gap dopo un salto). 5 semi: sezione 6 "non presente", **un solo gap che copre 20,0 s su 20** (prima: due pezzi, 13,5 s). Verdi sbagliati attorno: 0.

## 4. Interfaccia

- Sezione saltata: la pressione lunga non accende il loop, avviso "Questa sezione non è nell'audio" (e2e S1–S4).
- Correzione a orecchio: barra fissa con Anteprima e Salva (SE y 607–659 su 667, 13 e 320 px idem, con 35 accordi e dal primo istante); toccando un accordo si parte da lì; "Puoi fermarti quando vuoi: i tocchi fatti vengono salvati"; salvataggio parziale (solo gli accordi toccati si muovono, la sezione non è "verificata"; l'avviso dice "29 accordi" invece di elencarli).

## 5. Tempo libero (bug 6)

Banco: 132 sezioni libere su tre banchi (B4 del tester con 8 semi, banco del tester round 8, banco mio). Quota dei cambi entro 250 ms:

| soglia giallo | giallo (sezioni · quota) | rosso tutti i banchi | rosso banco B4 del tester |
|---|---|---|---|
| 0,35 (prima) | 107 · 86,4% | 25 · 47,5% | 52,5% |
| **0,30 (dopo)** | 110 · 85,4% | 22 · 47,5% | 52,4% |
| 0,17 | 123 · 81,8% | 9 · 45,6% | 49,0% (sezioni rosse solo 9: instabile) |

Obiettivi: giallo ≥ 75% ✓; mai verde ✓; rosso < 50% ✓ sull'insieme dei banchi, **✗ sul solo banco B4 (52,4%)**. Non si ottiene con le soglie: sotto 0,35 i cambi sono giusti nel 48–53% qualunque sia la soglia (i rossi del B4 sono arpeggi con note in comune, giusti a metà). Provati anche media, quantili 25/35% al posto della mediana: nessuno soddisfa tutti i vincoli. Scelta prudente 0,30; 0,17 raggiunge 49% su B4 ma con 9 sezioni rosse sparse (sovradattamento). Sul reale l'ultima sezione libera diventa gialla.

## 6. Testi

Parole intere ("sicura", "da controllare", "incerta", "tempo libero") in righe, legenda e conteggi; a 320 px stato e tempo vanno su due righe, mai troncati (e2e T1–T10 su 320/360/SE/13: 0 elementi tagliati, 0 overflow); una riga col motivo per gialle e rosse ("tempo libero: i cambi sono stimati", "tempi poco netti", "dura diversamente dalle sezioni uguali", "i cambi non cadono sui battiti"). Gap: "0:59–1:03: passaggio non scritto nel foglio (4 s)" / "parte non presente nel foglio", poi "nessuna azione richiesta". In play dentro un gap: pannello "♩–" (niente ≈153,7), il foglio scorre all'inizio della sezione che riprende (e2e G1–G3 sul reale).

## Aggiunta A — un tic per quarto

Causa: `buildAlignedTimeline` spalmava i battiti del foglio (spesso 4) sulla durata audio. Ora i battiti di un accordo sono `alignment.eventBeats` (o `round(durata·BPM/60)`), con il BPM misurato; nelle sezioni libere il BPM della sezione vicina che ne ha uno. `c.beats` del foglio non cambia. Non allineato sul reale: distribuzione dei battiti per accordo (durate stimate) `{1:15, 2:85, 3:7, 4:131, 5:2, 6:68, 8:18, 10:2}` (non tutti 4); un salvataggio schema 2 con durate "default" riceve le stimate alla migrazione (stessa distribuzione, verificato). Test unitari (2 quarti = 2 tic, sezione libera) e e2e `round10.cjs clicks` sul reale dopo la sincronizzazione: sezione 3, 141,4 BPM misurati, 74 tic in 30 s, **spaziatura mediana 425 ms (attesa 424)**, nessun accordo con più tic dei suoi quarti (36 accordi controllati).

## Aggiunta B — ritocco fine

`nudgeEvent` / `nudgeSection` / `snapshotTimes` / `restoreTimes` (puri, in `alignment.js`): nessun accordo sotto 0,1 s, ordine mai invertito (il passo si limita e lo dice), la sezione diventa "verificata". UI: pressione lunga su un accordo (foglio con −0,25 / −0,05 / +0,05 / +0,25, "Solo questo accordo" / "Questo e i seguenti della sezione", "Ascolta da qui" = 2 s prima, stop 2 s dopo, Annulla), tasto ⇄ sull'intestazione e sulla riga della sezione. e2e SE `round10.cjs nudge`: sezione −0,05 (8 accordi, solo loro), Annulla ripristina, accordo +0,25 senza toccare i vicini, evidenziazione in play sul nuovo tempo, persistenza dopo reload: 6/6.

## Test ed e2e

`npm test`: 250/250 (da 222), ~45 s. Test sul reale (tagli ×6, sezioni tolte ×3 + due sezioni, intero) saltati se manca la fixture.
E2E nuovi (`test/e2e/round10*.{cjs,mjs,sh}`): `round10.cjs texts|skip|gap|corr|clicks|nudge`, `round10-realcut.mjs`, `round10-real.mjs` (confronto evento per evento), `round10-free-bench.mjs`. 
**Regressione** (`bash test/e2e/round10-regress.sh`, build fresco, round 4–9 e script dei tester, più i nuovi): tutto verde (round4, 5, 6, 7 e tester, 8 e tester, 9 e tester incl. decodifica e prova da utente, `round10.cjs all`: 97 PASS) tranne:
- `round7-tester-app synth`: 1 FAIL atteso già dal round 9 (C3c, evidenziazione dal vivo nel tempo libero, 275 ms; C6b non eseguibile).
- `round8 all` / `round8-tester-app sync 320|360`: il controllo "una riga compatta per sezione ≤ 64 px" non vale più per scelta (le righe hanno ora fino a 2 righe di stato e la riga del motivo: 54–78 px a SE, 54–92 px a 320). Gli altri controlli (testo non tagliato, pulsanti ≥ 44 px, "Fatto" in vista) passano; avevano fallito K7/K9 (elenco accordi senza tempo, ora fino a 8 accordi elencati) e S2/S3 per un terzo pulsante che stringeva il nome a 320 px: tolto (il ritocco della sezione si apre toccando il testo della riga).
- `round9 texts`: verde dopo aver corretto lo stesso problema.

## Cosa non funziona / limiti

- Due sezioni tolte: il motore non può dire quali (strofe identiche); segna due dello stesso tipo.
- Il tempo libero resta indovinato: rosso 52% sul banco B4.
- La coerenza col battito non discrimina sul reale (solo rete di sicurezza).
- Il rumore forte sposta alcuni verdi a giallo (reale con rumore a 10 dB: la sezione 2, primo ritornello a 100 BPM, passa da verde a gialla perché la coerenza fra ritornelli misura un BPM diverso).
- Il taglio non è provato su iOS; le prove di taglio dipendono dal filtro dei 190 BPM (un foglio con durate molto sovrastimate non lo attiva: nessun peggioramento, ma nessun miglioramento).
