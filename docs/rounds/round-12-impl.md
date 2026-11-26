# Round 12 — Implementatore: accordi in ritardo su Android/Firefox, poi pausa per il feedback dell'utente

Leggi `CLAUDE.md`, `docs/reports/round-11-test.md` (bug 1–12, in particolare l'11), `docs/reports/round-11-impl.md`, `docs/DECISIONS.md` (sezione "Round 11"), `src/audio.js`, `src/ui/audiodecode.js`, `src/mp3frames.js` e `src/audiosync.js`. I `todo` in `test/regression/` del round 11 che risolvi diventano test normali; quelli che restano aperti restano `todo`.

**Questo è l'ultimo round prima di una pausa**: dopo, l'utente riascolta sul telefono e dà un feedback. Conta solo quello che l'utente sente.

## 1. Bloccante — Accordi in ritardo di ~0,5 s su Android + Firefox (segnalazione dell'utente)
L'utente usa Android con Firefox. Dopo aver rifatto la sincronizzazione, gli accordi evidenziati sono "in ritardo di mezzo secondo buono" dal Chorus 1 in poi (nella strofa lenta si nota poco). In Chromium l'app è a tempo: Chorus 1 a 0 ms di mediana dagli attacchi.

**Analisi del coordinatore.** L'mp3 reale è **VBR senza header Xing/VBRI**: 21.404 frame da 96–256 kbps, primo frame al byte 50.609. Senza tabella, un browser che fa il seek in proporzione al bitrate medio atterra lontano dal tempo chiesto:

| tempo chiesto | dove atterra | errore |
|---|---|---|
| 30 s | 31,08 s | +1,08 s |
| 63 s | 65,26 s | +2,26 s |
| 300 s | 297,29 s | −2,71 s |
| 450 s | 446,35 s | −3,65 s |

Firefox stima il seek con il bitrate dei frame già letti, quindi l'errore può essere minore ma non nullo. Dopo il seek riporta `currentTime` = tempo chiesto mentre suona un altro punto: l'evidenziazione è sfasata di una quantità costante fino al seek successivo. L'app fa seek spesso:
- play da una sezione o da un accordo;
- "Ascolta da qui";
- loop;
- il preroll;
- la ripresa.

Altre cause possibili:
- la latenza di uscita di Firefox su Android (con cubeb/AAudio non sempre giusta, o con altoparlanti Bluetooth);
- la decodifica a pezzi in Firefox (pezzi oltre i 45 s posizionati con il `delta` misurato solo sul primo pezzo; la tolleranza dell'1% lascia passare fino a 0,45 s).

Da fare, nell'ordine:

**a. Seek esatto per gli MP3 riconosciuti da `scanMp3`, in qualsiasi browser.** Non usare più `el.currentTime = T` per saltare.
- Ricostruisci la sorgente da un `Blob` che **parte da un frame esatto**: `bytes.slice(offsets[k − lead])`, con qualche frame di anticipo per il bit reservoir. Nota l'origine `t0 = (k − lead) × spf / sampleRate`.
- La posizione è `t0 + el.currentTime`; la riproduzione lineare dall'inizio di un blob è esatta in tutti i browser.
- Misura in Chromium l'eventuale ritardo fisso del decoder (priming) e compensalo.
- Gestisci:
  - velocità con `preservesPitch`;
  - stato di play/pausa;
  - loop (piccola pausa ammessa al giro, ≤ 150 ms, misurala);
  - durata totale (dalla scansione, non dal browser);
  - revoca degli URL.
- Per gli altri formati (m4a, ogg, wav) resta il seek normale.
- Test: in Chromium, seek a 30 / 63 / 150 / 300 / 450 s. L'evidenziazione deve stare sugli attacchi (metodo del tester, `round11-tester-*.py`) entro 50 ms, prima e dopo il cambio. Scrivi un test e2e che lo verifica.
- Facoltativo, solo se semplice e solido: aggiungi anche un frame Xing con TOC al blob di riproduzione.

**b. Decodifica a pezzi indipendente dal decoder.** Ogni pezzo si sovrappone al precedente di circa 1 s, oltre ai frame di anticipo. La posizione si trova con la **correlazione** del tratto sovrapposto, non con il `delta` del primo pezzo. Se la correlazione è debole o lo scarto supera 30 ms, torna alla decodifica intera. Riporta lo scarto per pezzo in Chromium.

**c. Regolazione "Evidenziazione in anticipo / in ritardo", raggiungibile dal pannello di play.**
- Pulsanti di ±50 ms, salvata per dispositivo (`gapp.device.v1`). Intervallo da −1000 a +1000 ms: oggi è da −100 a +400, troppo stretto per un ritardo di 0,5 s.
- Mostra il valore attuale.
- "Ascolta e regola": suona dal punto corrente per 5 s, così si sente subito l'effetto.
- La calibrazione esistente resta.

**d. Diagnostica esportabile** ("Informazioni tecniche" in Impostazioni), in un JSON senza testo del brano:
- user agent;
- metodo di decodifica (a pezzi o intera) e scarti per pezzo;
- tipo di MP3 (VBR o CBR, Xing sì o no);
- `outputLatency` e `baseLatency`;
- latenza impostata;
- durata secondo il browser e secondo la scansione;
- deriva misurata in play tra `el.currentTime` e l'orologio dell'`AudioContext` (pendenza e scarto ogni 10 s);
- i tempi dei primi 60 eventi dell'allineamento salvato.

L'utente potrà mandarlo al coordinatore.

## 2. Media — Bug del round 11
1. **Evento 306** (bug 1): la regola `chromaLead` in `refine.js` va ristretta.
   - Scatta solo se il nuovo accordo ha almeno una nota che il vecchio non ha e quella nota sale nel croma.
   - Scatta solo se c'è un attacco entro 0,15 s dal punto anticipato.
   - Deve tenere l'evento 32 (53,05) e rimettere il 306 vicino a 473,8. Il `todo` del tester diventa normale.
   - Confronta di nuovo tutti i 328 eventi con il round 11: elenca gli spostamenti oltre 0,1 s e dì se migliorano o peggiorano, con il metodo del tester.
2. **Tic nel tempo libero** (bug 2): i tic intermedi non stanno sui battiti, quindi suonano "fuori tempo". Nelle sezioni a tempo libero c'è **un tic accentato solo su ogni cambio d'accordo**, niente tic intermedi. Il pannello lo dice in piccolo ("tempo libero: un tic a ogni cambio").
3. **Guardia della pressione lunga** (bug 3, 4): non più un tempo fisso. Il foglio ignora solo il rilascio (`pointerup`/`click`) **dello stesso puntatore** che l'ha aperto, qualunque sia la durata; i tocchi successivi funzionano subito. Rilancia `round10.cjs` N1 e gli X1/X2/Y0/Y1 del tester.
4. Ritocco di una sezione con ancora (bug 5): si spostano solo gli accordi della sezione.
5. "Correggi a orecchio" con 35 accordi (bug 10): «Cambio!» non copre le istruzioni né le chip. Il K1 del round 9 torna a passare.
6. A 320 px i 4 pulsanti del ritocco stanno su una riga (bug 7).

I bug 6, 8 e 12 restano aperti: annotali nel report.

## Consegna
- Commit piccoli, `npm test` verde, niente push.
- Rilancia `round10-regress.sh` e gli e2e del round 11.
- `docs/reports/round-12-impl.md` con:
  - le misure del seek (prima/dopo, per tempo);
  - gli scarti per pezzo;
  - la tabella dei 328 eventi;
  - cosa resta da verificare sul telefono dell'utente;
  - le decisioni in `docs/DECISIONS.md`;
  - una risposta finale di 15 righe al massimo.
