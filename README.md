# Pokémon GO Showcase Helper

A small client-side web app for estimating scores in standard single-species **Biggest** Pokémon GO Showcases. Screenshots are processed in the browser; there is no backend, account, database, analytics, or screenshot upload endpoint.

## Local development

```sh
npm install
npm run dev
```

Choose several screenshots at once, use the file picker on mobile, or drop images onto the desktop upload panel. Each selected image becomes a separate scan with a fresh ID, including repeated images of the same Pokémon.

The first OCR run loads the Tesseract.js worker and English language data in the browser. OCR and canvas analysis run on-device. The app does not transmit the screenshot; it keeps only extracted fields in page memory and does not save scan history. Refreshing or closing the page clears the results.

## Testing and production build

```sh
npm test
npm run build
npm run preview
```

The fixture folder contains the four provided Machop and Bulbasaur screenshots. OCR tests run Tesseract against each image; IV tests decode the appraisal images to pixels and count the three five-point meter sections. Expected IV values are not read from app metadata or embedded in the application. The non-appraisal images are also checked to ensure no IV values are invented. The first test run downloads Tesseract's worker data if it is not already cached.

## GitHub Pages deployment

The Vite build uses relative asset paths, so it works at a repository subpath such as `https://account.github.io/repository/`.

1. Push the repository to GitHub.
2. In **Settings → Pages**, choose **GitHub Actions** as the build and deployment source.
3. Push to `main`; `.github/workflows/pages.yml` builds `dist/` and publishes it.

For a manual deployment, run `npm run build` and publish the contents of `dist/` as the Pages artifact.

## Supported data and score model

Initial species-specific size data is included for Bulbasaur (0.70 m, 6.9 kg, 1.75× XXL height class) and Machop (0.80 m, 19.5 kg, 1.75× class). Species without an explicit data row remain unsupported for scoring; no generic multiplier is substituted. Other Showcase formats are unsupported.

The community-reverse-engineered standard Biggest formula is:

```text
height points = (display height / species mean height / species XXL height class) × 800
weight points = (display weight / (species mean weight × XXL height class + 4 × weight deviation)) × 150
IV points     = ((Attack + Defence + HP) / 45) × 50
XXL bonus     = (150 × 1.75 / 2.05) + 50 when XXL, otherwise 0
```

CP is not used. The on-screen height and weight are rounded, so the app labels scores as estimates and shows a small input-rounding range. When IVs or XXL status are unknown, it widens the range instead of assuming values. A nickname can be copied once all three IVs and XXL status are known.

The score model is community research, not an official Niantic specification. A published Squirtle worked example is used as an independent regression check. The weight denominator uses the per-species Game Master weight deviation; for the two included species it is base weight / 8. Some XL measurements can exceed 150 weight points under the raw community formula, so the app retains the formula's result instead of silently clamping it.

## OCR limitations

- OCR depends on a legible screenshot, supported image decoding in the browser, and downloading Tesseract's English model on first use. Internet access is needed for that first model load unless the browser has cached it.
- Appraisal IV detection uses the colored pixel runs and neutral remainder of the three visible bars. It can miss bars obscured by overlays, compressed too heavily, or shown in a substantially different layout; review the values when flagged.
- Species text is taken from the OCR text when recognized. Nicknames can differ from species names, so the editable species field is the fallback.
- This MVP includes only two species' score constants. OCR can read other species, but their scores are marked unsupported until verified size data is added.
- XXL recognition is conservative. If it is unclear in the screenshot, the status remains unknown and the score is a range.

## Sources

- Pokémon GO Hub's [community explanation and Squirtle worked example](https://pokemongohub.net/post/news/showcase-scores-xxs-and-xxl-pokemon-and-how-it-works/) documents the 800/150/50 point shares, size classes, IV calculation, and rounded-measurement caveat.
- Pokémon GO Hub's [Bulbasaur size information](https://db.pokemongohub.net/pokemon/01) lists the 0.70 m mean and 1.225 m XXL upper size; its [Pokédex entry](https://db.pokemongohub.net/pokemon/1) lists the 6.9 kg mean weight.
- Hundo Hunter's [Machop size data](https://www.hundo-hunter.com/dex/66) lists the 0.80 m / 19.5 kg base and 1.40 m XXL upper size.
- No-Floats-Left's [2026 community research update](https://www.reddit.com/r/TheSilphRoad/comments/1ub6a1h/nofloatsleft_research_update_on_a_variety_of/) documents the weight-deviation correction and precise XXL bonus used in this build.
- Tesseract.js is used as a browser-side OCR engine; see its [project documentation](https://github.com/naptha/tesseract.js).
