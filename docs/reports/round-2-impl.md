# Report round 2 (implementatore)

## Fatto
- **Correzioni dal round 1** (tutte): parole mai spezzate (gruppi `span.w` nowrap, `buildLineGroups`), niente spazi segnaposto, span accordo senza nome ignorato con avviso, analisi span lineare (20000 span non chiusi < 1 s), icona tema SVG + etichetta, reimport con dialogo Sostituisci / Tieni entrambi / Annulla e `source.url` pulito, test sul file reale rafforzati (137 righe, 38 accordi `*`, `col` esatta, testo reso = `lyric`). I test di regressione del tester sono ora in `test/parser.test.js` senza `todo`; la cartella `test/regression/` è stata rimossa.
- **Tempo per sezione**: schema 2, `proposeSectionTempos`, BPM efficace, migrazione; sul file reale 62 / 96 / 142 come richiesto (asserito).
- **`timeline.js`** puro (+ conversioni battiti/tempo), **`player.js`** (nucleo scheduler puro + Web Audio, conteggio, loop, velocità, wake lock), **`taprecord.js`** (quantizzazione e tap tempo, puri).
- **UI**: pannello fisso in basso (accordo corrente con barra, prossimo con badge battiti, pallini battuta, ritmo UG con cella corrente, BPM, play/pausa/stop, velocità 50–100, clic on/off, tap tempo), evidenziazione e scorrimento (terzo superiore, pausa 4 s su scroll manuale), sezioni compresse che si aprono, BPM per sezione modificabile, loop con pressione lunga, modifica durate (−/+, copia su sezioni uguali, battiti per accordo 2/4/8 con conferma), registrazione col tap con anteprima Salva/Scarta. Tutto salvato subito.

## Verifiche
- `npm test`: **98 test, 98 ok**, 0 saltati. `npm run build` ok: **dist/index.html 121.227 byte (118,4 KB)**, 18 moduli.
- Playwright (`test/e2e/round2.cjs`, Chromium con autoplay flag, Pixel 7 a 360 px, file reale): 0 parole spezzate su 882 a scala 1,0 / 1,5 / 2,0 e nessuno scroll orizzontale (controllo negativo: con `white-space` normale la stessa misura trova 9 parole spezzate); 20 s di play: 1033 frame, 0 discordanze con la timeline, cambi di accordo con ritardo 5–18 ms dal previsto, deriva dell'orologio −4 ms su 17 s, 22 click creati; loop con giro e permanenza nella sezione; tap tempo; −/+ e salvataggio; registrazione col tap (con un tocco doppio) e salvataggio; persistenza dopo reload; reimport "Sostituisci" che conserva tempi e durate. Screenshot guardati: conteggio, play, pausa, loop, modifica, registrazione, anteprima, dialogo duplicato (in `test-artifacts/round-2/`, non versionati).
- Bug trovati dai miei screenshot e corretti: pannello più largo dello schermo con il ritmo da 16 celle; durante il conteggio veniva evidenziato l'accordo precedente e il BPM della prima sezione; la UI contava i tocchi doppi.

## Non verificato / limiti
- Nessuna prova su telefono reale (iOS/Safari: sblocco AudioContext, Wake Lock, latenza di uscita). In Chromium headless non si sente il suono: i click sono verificati solo contando gli oscillatori creati.
- Wake Lock e avviso "schermo potrebbe spegnersi" non esercitati nel test.
- Il pulsante "Copia durate su N sezioni uguali" è presente (9 nel file reale) ma non cliccato in e2e; la logica è semplice ma senza test automatico. Nel file reale i ritornelli non sono identici nel testo; la regola è nome base + stesse sequenze di accordi.
- Nessun test sulla soglia di riproduzione di 5 minuti senza scarti (spec) né su velocità < 100 % in e2e (coperto solo dai test della timeline).
- Il pannello in basso occupa circa 200 px su 780: lascia meno spazio al testo su schermi piccoli.

## Decisioni
Vedi `docs/DECISIONS.md`, sezione "Round 2" (tocco doppio a mezzo battito, "applica a tutte" per nome identico, conteggio a ogni avvio, modifica durate in vista piatta, ecc.).
