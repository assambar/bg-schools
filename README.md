# bg-schools

Compare private schools and kindergartens, built as a static GitHub Pages app with YAML data in this repo. The first instance is Sofia, with the context **ПГ 2 (PG2, the final preschool year, age 6–7) for school year 2027/2028**.

**Site:** https://assambar.github.io/bg-schools/

## How it works

The app is generic: it compares and helps choose between *entities* of any kind, described by a **domain**. Schools are the first (and shipped) domain; everything school-specific lives in [`domains/schools/`](domains/schools) and the data files it points to.

- **Domain config:** [`domains/schools/domain.yaml`](domains/schools/domain.yaml) names the catalog, data and criteria directories, the scope axes, locations, display hints, money, criteria page controls and the repository. Checked by [`schema/domain.schema.json`](schema/domain.schema.json) plus cross-file rules in [`src/lib/domain.ts`](src/lib/domain.ts).
- **Catalog:** [`data/catalog/dimensions.yaml`](data/catalog/dimensions.yaml) lists every fact the app knows (about 100 *dimensions* in 11 groups), each with a value type, optional scope and **retrieval instructions** (how to fetch or refresh it), plus the record types and value sets they use. [`grades.yaml`](data/catalog/grades.yaml) holds the values of the `grade` scope axis, [`neighborhoods.yaml`](data/catalog/neighborhoods.yaml) the areas a site can be in.
- **Schools:** one YAML file per school in [`data/schools/`](data/schools), named `<id>.yaml`. Values sit under `values:`, keyed by dimension id. A missing value means *unknown*; an explicit `false` means *confirmed no*.
- **Schema:** the JSON Schemas for entity files and criteria sets are generated from the domain at build time ([`src/lib/schema-gen.ts`](src/lib/schema-gen.ts)), so a new dimension is a data-only change. The catalog itself is checked by [`schema/catalog.schema.json`](schema/catalog.schema.json).
- **App:** Vite + TypeScript, no framework, no runtime requests. List, detail (values grouped by area, each with a source badge and an expandable "How to update this"), criteria ranking, and a YAML editor that validates live. Dimensions listed in the domain's `display.editor_fields` also get form fields above the YAML (checkboxes for `multi_enum`, radio buttons for `enum`); for schools that is `levels` (nursery, kindergarten, preschool, primary, lower/upper secondary), so a school can offer several levels at once. All views read the domain; no view has school-specific code.
- **Languages:** generic UI strings are in [`src/i18n/`](src/i18n), the domain's strings and labels in [`domains/schools/i18n/`](domains/schools/i18n) (`bg.json`, `en.json` in both). Default is the saved choice, then the browser language, then Bulgarian; `?lang=en` in the URL also works.
- **CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the hygiene check, validation, tests and build on every pull request; pushes to `main` deploy to GitHub Pages.

## Generic model

```yaml
# domains/<name>/domain.yaml
id: schools
entity: { route: school, id_pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }   # detail page #/school/<id>
paths: { catalog, overlays?, entities, criteria, i18n }             # repository-relative
scopes:                          # named scope axes; a dimension lists the ones it accepts (scopable)
  - { id: year, pattern: '^[0-9]{4}/[0-9]{4}$', consecutive: true, context: { default: 2027/2028 }, fit: { exact: 2, fallback: 0.5, fallback_unscoped: 0.5 } }
  - { id: grade, values_from: data/catalog/grades.yaml#systems.bg, list: true, measure: age, context: { default: pg2 }, fit: { … } }
  - { id: site, ref: sites }
locations?: { areas_from: …#neighborhoods, group_key: district, area_label: neighborhood, group_label: district }
display: { title: name, subtitle?: name_en, sort_locale?, list_columns: [{ dim, label? }], editor_fields?: [levels], new_template }
money?: { currencies: [EUR, BGN], base: EUR, rates: { BGN: 1.95583 } }
criteria: { kinds: [...], default_selection: [...], controls: [{ kind, type: toggle|select, label?, none? }] }
repo?: { name: owner/repo, branch: main }
storage_prefix: bg-schools       # browser-only state keys
```

- **Dimension types** (catalog): `bool`, `int`, `number`, `text`, `text_list`, `url`, `date`, `date_list`, `enum` / `multi_enum` (+ `values: <value set>`), `range`, `time_range`, `money`, or a **record type** declared in the catalog's `records:` (typed fields `bool | int | number | text | time_range | enum | money`, display `labels` / `format` / `hidden`, and a `presence` field used by `exists`). Schools declare `offering`, `service`, `fee_item`, `link` and `rating`.
- **Value record** (entity file): `{ v, src?, scope?, note? }`, or a list of them. `src` is the provenance `{ kind, source_ref, date, url?, ref?, by?, verified?, check?, note? }` (`defaults.src` fills gaps); `scope` maps scope-axis ids to values.
- **Criteria set:** `{ id, kind, require?: [rule], prefer?: [rule] }`, rules over dimension ids (`is`, `in`, `has`, `gte`/`lte`, `exists`, `where`, `covers: context`, `weight`) plus, with `locations`, area and distance rules. Unknown values never exclude; ranking uses score × coverage.
- **Another domain** is a new `domains/<name>/` (config, catalog, i18n) and its data; build it with `DOMAIN_DIR=domains/<name> npm run build`. [`tests/fixtures/laptops/`](tests/fixtures/laptops) is a tiny test-only example that is validated and rendered by the same code in the tests and never shipped.

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

`scope: { year: 2027/2028, grade: pg2, site: main }`, all optional; the axes come from the domain config. Each dimension declares which axes it accepts (`scopable`); CI rejects others. `grade` may be a list (`[pg1, pg2]`).

### Value types

`bool`, `int`, `number`, `text`, `text_list`, `url`, `date`, `date_list`, `enum` / `multi_enum` (values from a catalog `value_sets` entry), `range` (`{min, max}`), `time_range` (`08:00-18:30`), `money` (`{amount | min+max, currency: EUR|BGN, per: month|year|once, months?}`), and the schools domain's record types: `fee_item` (`{included, price?}`), `rating` (`{score, max, count?, site?}`), `offering` (`{offered, location?: on_site|off_site|both, included?, frequency?, partner?, from_age?}`), `service` (`{available, included?, hours?, frequency?, price?}`), `link` (`{exists, name?, grades?, same_campus?, curriculum?, tuition?}`).

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
- Labels: `criteria.set.<id>` in each domain dictionary. Kinds and page controls come from `criteria` in the domain config. `npm run validate` checks the files against the catalog.

## Personal status

Your own state (status per school: `research`, `to_visit`, `visited`, `shortlisted`, `rejected`; notes; gut feeling 1–5; chosen criteria sets; neighbourhoods; a reference point; a budget) stays out of this public repository. It lives in a **private repository of yours** and the site reads it with a GitHub token you paste on the **Personal status** page (`#/status`).

- **File convention:** `<name>.status.yaml` at the root of the private repository, or any `.yaml` file in its `status/` directory. The first file (in path order) that validates is used. The shape is defined by the domain config (`status:`) and checked with a generated JSON Schema plus id checks (unknown schools, criteria sets or neighbourhoods are errors). See [`domains/schools/status.default.yaml`](domains/schools/status.default.yaml) for an example; that neutral file is also what the site uses when no token is connected.
- **One token, one private repository:** the site lists the private repositories the token can read (`GET /user/repos?visibility=private`, all pages; public repositories never count, since fine-grained tokens can read every public repository). 0 private repositories → "token has no private repository access"; more than 1 → "token is too wide: it can access N private repositories"; exactly 1 → its status files are read. If none validates, the page lists each file and why it failed.
- **What it changes:** a "My status" column in the list and a box on the detail page; your criteria sets and neighbourhoods replace the browser's choices while connected; a `budget` adds a "My budget" option to the budget criteria; a `place` feeds distance rules. A banner "Personal status loaded from owner/repo" with a **Disconnect** button shows while connected.
- **Token handling:** read-only, sent only to `https://api.github.com` (also enforced by the site's Content Security Policy). It is kept in memory only, unless you tick "Remember the token on this device", which stores it in this site's `localStorage`. All `*.github.io` project sites of the same owner share that storage, so only opt in on your own device. Disconnect removes it.

**Recommended token setup:** GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate new token. Repository access: *Only select repositories* → just your private status repository. Permissions: **Contents: read-only** (and **Metadata: read-only**, which GitHub adds automatically). Set an expiry date. Nothing else.

## Universities, paths and finance

Three more pages sit next to the schools (links in the header):

- **Universities** (`#/universities`, detail `#/university/<id>`): a second, browse-only domain in [`domains/universities/`](domains/universities) with its catalog [`data/catalog/universities.yaml`](data/catalog/universities.yaml) and sample data in [`data/universities/`](data/universities): published 2026/27 fees, living costs, entry rules for the Bulgarian diploma, test policy and international aid, each value with its source. Values taken from a search summary of the official page are marked `verified: false, check: unconfirmed`; values not found are left out (shown as unknown). The same generic list and detail views render it; extra browse-only domains are listed in `EXTRA_DOMAIN_DIRS` ([`scripts/load-domain.ts`](scripts/load-domain.ts)).
- **Paths** (`#/paths`, one path `#/paths/<id>`): [`data/pathways/`](data/pathways) holds the stages, the transitions between them and 11 paths from PG2 to university, with their gates and fee schedules. A transition is a `mechanism` (an admission or continuation rule) or an `association` (where a school's pupils went, or how they scored), never causal: [`schema/pathways.schema.json`](schema/pathways.schema.json) has no causal kind and [`src/pathways/pathways.ts`](src/pathways/pathways.ts) rejects causal wording ("boosts", "raises your chance", "повишава шанса", ...). Evidence records year, sample size and source type; fewer than 20 pupils is flagged as a small sample, school self-reports are labelled. Each path shows its flowchart (mechanisms solid, associations dashed with year, N and source type), its gates and its cost for the family, with the standing note that the data shows where pupils went or how they scored, not what a school caused.
- **Finance** (`#/finance`): inputs (amount per child per month, children, 9 or 12 months, second-child offset, fee growth, return scenario) stay in the browser. The defaults (€1,000 per child per month, 2 children, 9 months, second child 2 years later) are adjustable examples in [`data/finance/assumptions.yaml`](data/finance/assumptions.yaml), with a source for every fixed number. [`src/pathways/finance.ts`](src/pathways/finance.ts) computes, in the browser: fees paid per path, the value of investing the same money in an S&P 500 UCITS fund (pessimistic / cautious / base / optimistic from the 1928-2025 history in [`data/finance/sp500-total-return.csv`](data/finance/sp500-total-return.csv), after TER, 0% Bulgarian tax on EU regulated-market disposals), borrowing it as consumer loans (BNB rates), three other uses of the money, university costs per child and the bottom line. It is a port of the reference calculator [`scripts/pathways/finance-reference.py`](scripts/pathways/finance-reference.py); `tests/finance.test.ts` checks both give the same numbers for the defaults.

Both pages carry two disclaimers (also in the footer of every page): the projections ignore the AI revolution, and nothing here is financial advice.

### Diagrams: pre-rendered, no Mermaid in the browser

The diagrams are Mermaid, generated from the data and rendered to SVG ahead of time, so the site ships no Mermaid runtime (about 1.5 MB gzipped) and the Content Security Policy stays strict (`script-src 'self'`, `style-src 'self'`; the SVGs load as images). The interactive numbers on the Finance page are plain tables and a small chart drawn with SVG elements.

- `npm run diagrams` ([`scripts/pathways/build-diagrams.ts`](scripts/pathways/build-diagrams.ts)) writes `generated/diagrams/paths/<path>.<lang>.mmd` (flowcharts), `generated/diagrams/money/<id>.<lang>.mmd` (sankey-beta, xychart-beta and a decision flowchart, for the default inputs) and `generated/finance/defaults.json`.
- `npm run diagrams:render` ([`scripts/pathways/render-diagrams.ts`](scripts/pathways/render-diagrams.ts)) renders changed sources to SVG with the pinned `@mermaid-js/mermaid-cli@12.0.0` (needs Chrome: `CHROME_PATH=/usr/bin/google-chrome`) and records the sha256 of each source in `generated/diagrams/rendered.json`. Commit the SVGs.
- CI runs `npm run diagrams:check`: it regenerates the sources and fails on any difference in `generated/`, or when an SVG was rendered from older text. CI doesn't render (no Chrome needed there).
- Mermaid's sankey parser accepts ASCII text only, so the sankey labels are in English in both languages.

## Adding things

- **A dimension:** add it to `dimensions.yaml` (or to a `families` list) and add `dim.<id>` (plus any new `enum.<set>.<value>`) to every file in `domains/schools/i18n/`. Tests fail if a label is missing.
- **A language:** copy `src/i18n/en.json` and `domains/schools/i18n/en.json` to `<code>.json` and translate them. It appears in the language menu automatically.

## Repository hygiene

`npm run hygiene` fails if certain private tool names appear in any tracked file. Imported data is labelled "sample data" (`ref: sample-2026-10`). Personal notes (status, visit impressions, budget, home location) never go into this repo.

## Local development

Requires Node 22.18+ (CI uses Node 24).

```sh
npm ci
npm run dev        # http://localhost:5173/bg-schools/
npm run validate   # domains (schools, universities), data, criteria, pathways, finance inputs
npm run diagrams   # regenerate generated/ (then diagrams:render for the SVGs)
npm run hygiene
npm test
npm run build      # output in dist/
```
