# bg-schools

Compare private schools and kindergartens, built as a static GitHub Pages app with YAML data in this repo. The first instance is Sofia, with the context **ПГ 2 (PG2, the final preschool year, age 6–7) for school year 2027/2028**.

**Site:** https://assambar.github.io/bg-schools/

## How it works

- **Catalog:** [`data/catalog/dimensions.yaml`](data/catalog/dimensions.yaml) lists every fact the app knows (about 100 *dimensions* in 11 areas), each with a value type, optional scope and **retrieval instructions** (how to fetch or refresh it). [`grades.yaml`](data/catalog/grades.yaml) is the grade ladder, [`neighborhoods.yaml`](data/catalog/neighborhoods.yaml) the places a site can be in.
- **Schools:** one YAML file per school in [`data/schools/`](data/schools), named `<id>.yaml`. Values sit under `values:`, keyed by dimension id. A missing value means *unknown*; an explicit `false` means *confirmed no*.
- **Schema:** generated from the catalog at build time ([`src/lib/schema-gen.ts`](src/lib/schema-gen.ts)), so a new dimension is a data-only change. The catalog itself is checked by [`schema/catalog.schema.json`](schema/catalog.schema.json).
- **App:** Vite + TypeScript, no framework, no runtime requests. List, school detail (values grouped by area, each with a source badge and an expandable "How to update this"), and a YAML editor that validates live.
- **Languages:** UI and catalog labels come from [`src/i18n/`](src/i18n) (`bg.json`, `en.json`). Default is the saved choice, then the browser language, then Bulgarian; `?lang=en` in the URL also works.
- **CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the hygiene check, validation, tests and build on every pull request; pushes to `main` deploy to GitHub Pages.

## School file

```yaml
id: example-kindergarten
name: ЧДГ „Пример“
sites:
  - id: main
    address: ul. Example 1
    neighborhood: izgrev          # or a list when the source names several
    src: { source_ref: src-101 }
defaults:                          # applied to every value without its own field
  src: { kind: imported, ref: sample-2026-10, date: 2026-10-07 }
values:
  full_day: { v: true, src: { source_ref: src-102 } }
  tuition:                         # several entries: one per scope or source
    - v: { amount: 550, currency: EUR, per: month }
      scope: { year: 2027/2028, grade: pg2 }
      src: { kind: extracted, source_ref: src-103, date: 2026-10-08, url: https://example.bg/fees, verified: true }
  activity.swimming:
    v: { offered: true, location: off_site, included: false, partner: city pool }
    src: { source_ref: src-104, check: manual }
retrieval:                         # optional per-school override of the catalog instructions
  tuition: { steps: [ "Fees are only in the PDF price list linked from the home page." ] }
```

### Provenance (`src`)

| field | meaning |
|---|---|
| `kind` | `extracted` (from a web page by a script or agent), `manual` (typed in from a cited source), `call`, `visit`, `user-edit` (set by the app's editor), `imported` (bulk import; `ref` names the batch), `derived` (computed from other values) |
| `date` | as-of date, required (here or in `defaults.src`) |
| `url` | required for `extracted` and `manual` |
| `source_ref` | required on every value and site; a stable opaque id (`src-001`) that is unique across the repo. Maintainers can trace it to the original source in their own records. |
| `verified` | `true` once the value was checked against its source |
| `check` | a flag: `manual` (needs a call or visit), `conflict` (sources disagree), `unconfirmed`, `stale` |

The app shows the entry that fits the chosen year and group best (exact scope, then unscoped), then by source (`visit > call > manual > user-edit > extracted > imported > derived`), then newest. Entries for another year or group are shown with a "for another year or group" badge.

### Scope

`scope: { year: 2027/2028, grade: pg2, site: main }`, all optional. Each dimension declares which keys it accepts (`scopable`); CI rejects others. `grade` may be a list (`[pg1, pg2]`).

### Value types

`bool`, `int`, `number`, `text`, `text_list`, `url`, `date`, `date_list`, `enum` / `multi_enum` (values from a catalog `value_sets` entry), `range` (`{min, max}`), `time_range` (`08:00-18:30`), `money` (`{amount | min+max, currency: EUR|BGN, per: month|year|once, months?}`), `fee_item` (`{included, price?}`), `rating` (`{score, max, count?, site?}`), `offering` (`{offered, location?: on_site|off_site|both, included?, frequency?, partner?, from_age?}`), `service` (`{available, included?, hours?, frequency?, price?}`), `link` (`{exists, name?, grades?, same_campus?, curriculum?, tuition?}`).

### Retrieval instructions

Each catalog dimension has `retrieval: { methods, cadence, automatable, steps }`. `methods` refer to shared procedures in `retrieval_methods` (school website, official register, review sites, call, visit); `steps` are specific to the dimension. A school file can add steps (or replace them with `replace: true`) under `retrieval:`. The detail view shows the merged instructions under "How to update this".

Source-specific steps can live in their own file, `data/catalog/retrieval.<name>.yaml`, with the catalog's shape: `retrieval_methods` to add, and `dimensions: { <id>: { methods, steps, note } }`. Such files are loaded automatically; their methods are added and their steps appended after the catalog's. Adding or removing a source's steps is adding or removing one file.

## Sample data

The 24 files in `data/schools` are sample data (`ref: sample-2026-10`), imported on 2026-10-07 and re-checked against the schools' own websites on 2026-10-08 by following the retrieval instructions:

- `kind: imported`, no `url`: as imported; not re-confirmed.
- `kind: extracted` with `url` and `verified: true`: confirmed or corrected from that page on that date (new values found during the re-check are also `extracted`).
- `check: conflict`: a source disagrees (the note says how); `check: unconfirmed`: not found online; `check: manual`: needs a call or visit.

Missing values are unknown, not "no". Free-text notes are in English for now.

## Criteria sets

[`data/criteria/*.yaml`](data/criteria) rank schools on the Criteria page (`#/criteria`, or `#/criteria/basics+budget-low+location-near` to share a combination):

```yaml
id: budget-low
kind: budget                     # basics | budget | location | custom
require:                         # hard: a known value that fails excludes the school
  - { dim: tuition, lte: { amount: 6000, currency: EUR, per: year } }
prefer:                          # soft: scored, optional weight (default 1)
  - { dim: fee.meals, where: { included: true }, weight: 2 }
```

- Operators: `is`, `in`, `has` (lists), `gte` / `lte` (numbers or money), `exists`, `where` (fields of an object value), `covers: context` (an age range covers the chosen group). Location: `neighborhood: { in: [...], editable: true }` and `within_km: { km }`.
- Unknown values never exclude: the school stays and is marked **unverified**. The same happens if a hard rule rests on a flagged, unverified or other-year value.
- Score = soft points met ÷ soft points with a known value; coverage = known ÷ all. The ranking puts confirmed schools first, then sorts by score × coverage.
- Money is compared per year in EUR: monthly × `months` (default 12); BGN at 1.95583.
- Defaults: `basics`; `budget-low` / `budget-medium` / `budget-high` (sample caps of €6,000 / €9,000 / €25,000 a year); `location-near` (only your neighbourhoods), `location-wider` (near ones rank higher), `anywhere`. Your neighbourhood list is chosen on the page and kept in the browser only. No site has coordinates yet, so distance rules have nothing to work with.
- Labels: `criteria.set.<id>` in each dictionary. `npm run validate` checks the files against the catalog.

## Adding things

- **A dimension:** add it to `dimensions.yaml` (or to a `families` list) and add `dim.<id>` (plus any new `enum.<set>.<value>`) to every file in `src/i18n/`. Tests fail if a label is missing.
- **A language:** copy `src/i18n/en.json` to `<code>.json` and translate it. It appears in the language menu automatically.

## Repository hygiene

`npm run hygiene` fails if certain private tool names appear in any tracked file. Imported data is labelled "sample data" (`ref: sample-2026-10`). Personal notes (status, visit impressions, budget, home location) never go into this repo.

## Local development

Requires Node 22.18+ (CI uses Node 24).

```sh
npm ci
npm run dev        # http://localhost:5173/bg-schools/
npm run validate   # catalog + data/schools/*.yaml
npm run hygiene
npm test
npm run build      # output in dist/
```
