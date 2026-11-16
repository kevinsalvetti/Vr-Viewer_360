# Visualizzatore 360° VR — tour per Meta Quest

Visualizzatore di panorami **equirettangolari** mono e **stereoscopici** (es. *Lumion → Stereo Panorama*)
con **tour** a più scene collegate da punti di teletrasporto. HTML/JavaScript puro (WebGL2 + WebXR),
nessuna dipendenza. Ospitato su **GitHub Pages**, così dal Quest basta aprire un indirizzo:

**https://kevinsalvetti.github.io/Vr-Viewer_360/**

## Sul Meta Quest 3

1. Apri il browser del visore e vai all'indirizzo qui sopra (salvalo nei preferiti).
2. Scegli un tour dall'elenco **Tour disponibili** (oppure apri `…/Vr-Viewer_360/?tour=NomeCartella`).
3. Premi **Entra in VR**.

Comandi in VR:

| Comando | Azione |
|---|---|
| Grilletto (o pizzico con le mani) puntando un cerchio blu | vai alla scena indicata dall'etichetta |
| Levetta ← / → | ruota la vista di 30° (comodo da seduti) |
| A / X | scena successiva |
| B / Y | scena precedente |
| Tasto Meta | esci dalla VR |

Arrivando con un punto si guarda nella direzione del viaggio; aprendo una scena dall'elenco si usa la sua *vista iniziale*.
Le scene collegate vengono scaricate in anticipo per rendere il passaggio più rapido.

## Creare un tour (sul computer)

1. Doppio clic su **`avvia.bat`** (server locale su `http://localhost:8080/`).
2. **Apri** (o trascina) tutte le immagini 360 del tour.
3. Nel pannello **Scene** attiva **Modifica collegamenti** (`E`):
   - clic sulla vista → scegli la scena di destinazione (con *Crea anche il ritorno* viene creato il punto inverso);
   - clic su un punto esistente → *Vai* / *Elimina* (anche tasto destro = elimina);
   - **Imposta vista iniziale** salva la direzione di partenza della scena corrente;
   - ☆ sceglie la scena da cui parte il tour; ✎ rinomina (il nome compare come etichetta sui punti).
4. Scrivi il **Nome del tour** e premi **Esporta tour…** (Chrome/Edge): scegli o crea la cartella
   `tours\NomeTour` dentro questo progetto. Vengono scritti `tour.json` e le immagini.
5. Doppio clic su **`pubblica.bat`**: aggiorna `tours/index.json`, fa commit e push su GitHub.
   Dopo 1–2 minuti il tour compare nell'elenco anche sul Quest.

Per modificare un tour già pubblicato: aprilo dall'elenco (anche in locale), attiva la modifica e riesportalo nella stessa cartella.

Struttura:

```
tours/
  index.json            ← generato da pubblica.bat
  NomeTour/
    tour.json           ← scene, collegamenti, vista iniziale, layout stereo
    scena1.jpg  scena2.jpg …
```

## Formato immagini

Lumion salva i panorami stereo **Sopra/Sotto** (occhio sinistro in alto), tipicamente quadrati (es. 8192×8192).
Il layout è rilevato dalle proporzioni (≈1:1 Sopra/Sotto, ≥3:1 Affiancato, ≈2:1 Mono) e si può forzare dalla barra;
viene salvato nel tour. Se la profondità risulta invertita usa **Scambia occhi** (`S`).

Consigli per GitHub e Quest:
- **JPG** qualità 85–92: GitHub rifiuta file oltre 100 MB (e `pubblica.bat` avvisa oltre 95 MB); il sito intero dovrebbe restare sotto ~1 GB.
- Sul Quest le texture sono limitate a 8192 px per lato: immagini più grandi vengono ridotte automaticamente.
- Un 8192×8192 stereo pesa circa 10–25 MB in JPG: il primo caricamento dipende dal Wi-Fi.

## Altre funzioni

- **Apri tour (.json + immagini)**: apre un tour da file locali (seleziona insieme `tour.json` e le immagini).
- **Scene di prova** / **Prova**: genera due scene stereo sintetiche collegate, per verificare senza render.
- Visualizzazioni desktop: singolo occhio, anaglifo rosso/ciano, affiancato (Cardboard / TV 3D).
- Tasti: trascina/frecce = guarda · rotellina/pizzico/`+` `-` = zoom · `C` centra · `F` schermo intero ·
  `N`/`B` scena successiva/precedente · `E` modifica · `P` pannello · `H` nascondi barra · `?` aiuto.

## File

`index.html`, `style.css`, `app.js` (render WebGL2 + WebXR), `serve.ps1` + `avvia.bat` (server locale),
`pubblica.ps1` + `pubblica.bat` (indice tour + push), `tours/` (tour pubblicati), `.nojekyll` (GitHub Pages servito così com'è).
