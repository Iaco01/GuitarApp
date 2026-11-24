# Accordi a tempo

Web app statica per telefono: importa una pagina Ultimate Guitar salvata come file `.mht`, la mostra in modo leggibile (accordi colorati sopra la sillaba giusta) e, nei round futuri, la suona a tempo. Nessuna dipendenza, nessuna rete a runtime.

## Build

```
npm run build        # produce dist/index.html (un solo file, CSS e JS inline)
```

Apri `dist/index.html` direttamente (`file://`) o da un server statico. Per sviluppare, servi la cartella con un server statico (es. `python3 -m http.server`) e apri `index.html`: i moduli ES non si caricano da `file://`.

## Test

```
npm test             # node --test "test/*.test.js"
npm run fixtures     # rigenera test/fixtures/synthetic/*.mht (testo inventato)
```

Il test sul file reale (`test/fixtures/local/american-pie.mht`, fuori da git perché contiene testo protetto) viene saltato se il file manca.

## Come salvare una pagina Ultimate Guitar

- **Chrome per computer** (modo sicuro oggi): apri il brano, menu ⋮ → Salva, stampa e condividi → Salva pagina come, formato «Pagina web, singolo file (.mht)». Poi passa il file al telefono e importalo dall'app.
- **Chrome Android / Safari iOS**: il salvataggio MHTML può non essere disponibile; se lo è, salva la pagina e importa il file con «Importa .mht».
