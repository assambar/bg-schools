# bg-schools

Research tracker for Sofia private preschools and schools, built as a static GitHub Pages app with YAML data in this repo.

**Site:** https://assambar.github.io/bg-schools/

## How it works

- **Data:** one YAML file per school in [`data/schools/`](data/schools), named `<id>.yaml`. This repo is the database; every change is a commit, ideally via a pull request.
- **Schema:** [`schema/school.schema.json`](schema/school.schema.json) (JSON Schema 2020-12). The same schema is used by CI, the build and the in-browser editor.
- **App:** Vite + TypeScript, no framework. The YAML is read at build time and bundled, so the site has no backend and makes no runtime requests.
- **Editor:** "Add school" or click a school to edit it. The form validates live, generates YAML, and lets you copy it, download it, or open GitHub's editor with the file (new entries are pre-filled; for existing ones, paste the copied YAML).
- **CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) validates data, runs tests and builds on every pull request. Pushes to `main` also deploy to GitHub Pages.

## Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | kebab-case, must equal the file name |
| `name` | yes | |
| `status` | yes | `research`, `check`, `call-needed`, `to-visit`, `visited`, `shortlisted`, `rejected` |
| `type` | no | `kindergarten`, `preschool`, `school` |
| `district` | no | neighborhood or district |
| `website` | no | `http(s)://` URL |
| `open_day` | no | `YYYY-MM-DD` |
| `notes` | no | free text |

## Local development

Requires Node 22.18+ (CI uses Node 24).

```sh
npm ci
npm run dev        # http://localhost:5173/bg-schools/
npm run validate   # check data/schools/*.yaml
npm test
npm run build      # output in dist/
```
