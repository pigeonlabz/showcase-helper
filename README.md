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

The fixture folder contains Machop and Bulbasaur screenshots with and without appraisal, plus the Staryu appraisal regression screenshot. OCR tests run Tesseract against each image; IV tests decode the appraisal images to pixels and count the three five-point meter sections. Expected IV values are not read from app metadata or embedded in the application. The non-appraisal images are also checked to ensure no IV values are invented. The first test run downloads Tesseract's worker data if it is not already cached.

## GitHub Pages deployment

The Vite build uses relative asset paths, so it works at a repository subpath such as `https://account.github.io/repository/`.

1. Push the repository to GitHub.
2. In **Settings → Pages**, choose **GitHub Actions** as the build and deployment source.
3. Push to `main`; `.github/workflows/pages.yml` builds `dist/` and publishes it.

For a manual deployment, run `npm run build` and publish the contents of `dist/` as the Pages artifact.

## Supported data and score model

The bundled `src/data/species-sizes.json` contains 1,109 verified Pokémon and form profiles. Each row has its own mean height, mean weight, weight standard deviation and XXL height class. Bulbasaur and Machop retain their original constants; Staryu is also covered. Form-specific names can be entered in the species field, including regional and other forms present in the dataset.

Profiles are included only when the source marks them `verified` and every scoring constant is numeric. This snapshot excludes 21 unverified rows and 53 rows missing a required constant. For example, Pumpkaboo and Gourgeist use a custom four-size system rather than ordinary XXL classes, and remain unsupported. Some temporary forms have no Game Master weight deviation; their base form's deviation is not reused. Unsupported species or forms continue to show **Scoring unavailable**, with extracted measurements retained. No generic multiplier is substituted. Other Showcase formats are unsupported.

The community-reverse-engineered standard Biggest formula is:

```text
height points = (display height / species mean height / species XXL height class) × 800
weight points = (display weight / (species mean weight × XXL height class + 4 × weight deviation)) × 150
IV points     = ((Attack + Defence + HP) / 45) × 50
XXL bonus     = (150 × 1.75 / 2.05) + 50 when XXL, otherwise 0
```

CP is not used. The on-screen height and weight are rounded, so the app labels scores as estimates and shows a small input-rounding range. When IVs or XXL status are unknown, it widens the range instead of assuming values. A nickname can be copied once all three IVs and XXL status are known.

The score model is community research, not an official Niantic specification. The exact-input results below were checked against the independent [PGO-XXL-DB Showcase calculator](https://pgoxxldb.com/en/size-calculator/?pokemon=no0120) using its current public calculator core and size data. The calculator's public source values and our local table agree for these cases.

| Pokémon | Height | Weight | IVs | XXL | Point-input score |
| --- | ---: | ---: | --- | --- | ---: |
| Bulbasaur | 1.18 m | 11.55 kg | 10/7/8 | Yes | 1088.033006 |
| Machop | 1.33 m | 36.06 kg | 15/6/14 | Yes | 1100.219721 |
| Staryu | 1.32 m | 56.36 kg | 12/15/12 | Yes | 1084.576041 |

These are unrounded point-input calculations. The independent calculator also reports rounded measurement intervals; in-game scores can differ because Pokémon GO displays rounded measurements. Some XL measurements can exceed 150 weight points under the raw community formula, so the app retains the formula's result instead of silently clamping it.

As a second check, applying the independent [Pokémon GO Coordinates calculator's published client formula](https://pokemongocoordinates.com/showcase/) to the same inputs yields integer totals of 1088, 1100 and 1085. Its formula uses `mean weight × (XXL class + 0.5)`; these species have a Game Master weight deviation of exactly `mean weight / 8`, making that denominator equivalent to the one used here. Its flat bonus is 178 points rather than 178.04878, which does not change these rounded totals.

### Size data source and regeneration

The checked-in table was generated from the verified rows of Brandon Enright's [`pogo_size` Game Master extractor](https://github.com/bmenrigh/pogo_size/tree/395bee67c5bb0e774e137f25acf7a19946e2c388). Source revision: `395bee67c5bb0e774e137f25acf7a19946e2c388`; source table SHA-256: `8a14b5286de87acd0b4f4e64c32215d63ed5da437c0f6beecf2dfccd31a9fea3`. The [parser](https://github.com/bmenrigh/pogo_size/blob/395bee67c5bb0e774e137f25acf7a19946e2c388/read_pokemon_stats_from_gm.py) reads mean height, mean weight, `weightStdDev`, and extended Pokémon size settings from a complete decoded Game Master; its [documentation](https://github.com/bmenrigh/pogo_size/blob/395bee67c5bb0e774e137f25acf7a19946e2c388/readme.md) describes its validation and special-form handling. Pokémon GO Game Master snapshots are maintained by [PokeMiners](https://github.com/PokeMiners/game_masters). The upstream extractor does not embed a reliable original Game Master snapshot date, so the source commit and table hash identify this data snapshot, but not the exact game version it came from.

To refresh the table:

1. Check out or download a reviewed `pogo_size` revision and obtain a complete decoded `GAME_MASTER.json` from a trusted Game Master source.
2. From that checkout, extract the TSV and review any validation warnings:

   ```sh
   python read_pokemon_stats_from_gm.py GAME_MASTER.json > pokemon_stats.tsv
   ```

3. From this project, pass the TSV path and the extractor repository's full commit SHA:

   ```sh
   npm run generate:species -- ../pogo_size/pokemon_stats.tsv 395bee67c5bb0e774e137f25acf7a19946e2c388
   ```

The generator bundles only rows marked `verified` with finite mean, deviation and one of the supported 1.55, 1.75 or 2.00 XXL height classes. It records the source revision and input checksum in the JSON. It intentionally does not apply guessed constants to unverified forms or rows with missing deviations. Review the upstream validation rules when Game Master fields or size classes change.

## OCR limitations

- OCR depends on a legible screenshot, supported image decoding in the browser, and downloading Tesseract's English model on first use. Internet access is needed for that first model load unless the browser has cached it.
- Appraisal IV detection uses the colored pixel runs and neutral remainder of the three visible bars. It can miss bars obscured by overlays, compressed too heavily, or shown in a substantially different layout; review the values when flagged.
- Species text is taken from the OCR text when recognized. Nicknames can differ from species names, so the editable species field is the fallback.
- OCR can recognize species beyond this scoring dataset. A profile absent from the verified local table remains unsupported for scoring.
- XXL recognition is conservative. If it is unclear in the screenshot, the status remains unknown and the score is a range.

## Sources

- Pokémon GO Hub's [community explanation and Squirtle worked example](https://pokemongohub.net/post/news/showcase-scores-xxs-and-xxl-pokemon-and-how-it-works/) documents the 800/150/50 point shares, size classes, IV calculation, and rounded-measurement caveat.
- Pokémon GO Hub's [Bulbasaur size information](https://db.pokemongohub.net/pokemon/01) lists the 0.70 m mean and 1.225 m XXL upper size; its [Pokédex entry](https://db.pokemongohub.net/pokemon/1) lists the 6.9 kg mean weight.
- Hundo Hunter's [Machop size data](https://www.hundo-hunter.com/dex/66) lists the 0.80 m / 19.5 kg base and 1.40 m XXL upper size.
- No-Floats-Left's [2026 community research update](https://www.reddit.com/r/TheSilphRoad/comments/1ub6a1h/nofloatsleft_research_update_on_a_variety_of/) documents the weight-deviation correction and precise XXL bonus used in this build.
- Tesseract.js is used as a browser-side OCR engine; see its [project documentation](https://github.com/naptha/tesseract.js).
