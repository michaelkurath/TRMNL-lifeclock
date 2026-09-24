# Life Clock

Life Clock is a TRMNL plugin that compresses a statistical lifetime into a 24-hour clock.

Instead of taking life expectancy at birth and treating it as a fixed expiry age, Life Clock uses **age-specific remaining life expectancy E(x)** for the user's current age, sex category and country/area. The result is a population statistic, not an individual prediction.

## How it works

For the current exact age:

```
remaining years = E(current age)
statistical lifetime = current age + remaining years
progress = current age / statistical lifetime
Life Clock time = progress × 24 hours
```

Examples of the clock scale:

- 25% → 06:00
- 50% → 12:00
- 75% → 18:00
- 90% → 21:36

The statistical lifetime is recalculated as the user gets older because E(x) is conditional on having survived to the current age.

## Data

Life Clock uses:

- United Nations DESA, Population Division
- **World Population Prospects 2024**
- Indicator: **Life expectancy E(x) - complete**
- **2026 Medium projection**
- single-year ages **0–100**
- Male and Female life-table categories
- **237 countries/areas**

The UN defines E(x) as the average number of years remaining to be lived by those surviving to exact age x under the given age-specific mortality rates.

The runtime files are generated directly from the official WPP bulk CSV.GZ files by `scripts/build_wpp_life_expectancy.py`. Source URLs and SHA-256 checksums are recorded in `data/manifest.json`.

UN WPP data are provided under **CC BY 3.0 IGO**. See the UN Data Portal and WPP documentation for source methodology and terms.

## Privacy model

The external polling request contains only the selected **country code**:

```
data/countries/{{ country_code }}.json
```

Date of birth and the selected Male/Female life-table category are handled by TRMNL Serverless and are not sent to the GitHub-hosted life-table endpoint.

## Runtime architecture

Each country/area has its own compact JSON file under `data/countries/`. A TRMNL refresh downloads only the selected country table instead of a global dataset. This keeps the polling payload small and well below TRMNL's external polling size limit.

## Languages

The display supports **English** and **German (Deutsch)**. German mode also uses decimal commas and localizes supported region names from the ISO-2 country code, with the original UN location name as a safe fallback.

## Settings

- Language / Sprache
- Date of birth
- Sex in life table: Male / Female
- Country of residence
- Show statistical years remaining
- Optional statistical horizon year

The horizon year is deliberately optional. It is an approximate statistical year, not a predicted date of death.

## Limitations

- This is a **population estimate**, not medical or individual mortality advice.
- Country of residence is a population-level proxy.
- The source life tables use Male/Female categories; the plugin mirrors the categories published by WPP.
- Exact ages above 100 are not currently supported.
- Lifestyle, medical history, family history and individual risk factors are intentionally not used.

## Development and QA

The repository validates:

- 237 country/area runtime files
- Male + Female tables for every country
- 101 exact ages per table
- source manifest and release metadata
- country selector ↔ data-file consistency
- deterministic transform calculations and edge cases
- `trmnlp lint`
- genuine TRMNLP PNG renders for TRMNL OG and TRMNL X across all four layouts

Relevant commands:

```sh
python3 scripts/validate_data.py
node test/transform.test.js
trmnlp lint
python3 scripts/trmnlp_qa.py
```

The GitHub Actions workflows run these checks automatically.

## Regenerating WPP data

```sh
python3 scripts/build_wpp_life_expectancy.py 2026
```

This downloads the official UN WPP 2024 Male and Female complete life-table archives, extracts E(x) for 2026, regenerates the 237 runtime files and rebuilds the country selector.

## License

Original plugin code, markup and documentation: **CC BY 4.0**, published in accordance with the TRMNL Community Plugin License.

The UN WPP dataset is third-party material and remains under its own **CC BY 3.0 IGO** terms.
