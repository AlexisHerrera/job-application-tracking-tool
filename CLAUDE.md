# Job application tracker

Local app (docker compose): FastAPI + Postgres backend in `backend/`, React + Vite + Tailwind/shadcn frontend in `frontend/`. `docs/plan.md` lists only the open work: remove an item once it's done. The design decisions and history of what's built are in git (`git show 95af9fb:docs/plan.md`); read the relevant section before changing a feature.

## How we work

- **The user reviews the frontend themselves.** Don't take screenshots, drive a browser, or use the Chrome extension to check UI work. Typecheck and build the frontend (`npm run typecheck`, `npm run build` in `frontend/`), then hand it over for review.
- Build in phases and stop for review at the end of each one.
- Ask before anything that reads the real Gmail inbox or Google Calendar, touches AWS, or costs money (LLM calls). The app stays local for now.
- Never mutate the real local `jobtracker` database while testing. Use the test suite, or a throwaway database.
- Work on a branch and open a PR. Merging to `main` deploys the parts that changed (`.github/workflows/ci.yml`, `docs/setup.md` "Shipping changes"). Don't run the deploy scripts against prod yourself; `.tf` changes are still planned here and applied by the user, before the merge that needs them.

## Frontend structure

Feature-folder layout under `frontend/src/`, one component per file (set up by the 2026-11 refactor):

- `pages/<name>/<Name>Page.tsx`: one kebab-case folder per route; the page is a default export and mostly loads data and lays out its parts. What only that route uses stays in its folder (subfolders for big areas, like `discover/settings/`).
- `features/<domain>/`: domain pieces used by two or more pages or by the shell. `components/`: generic UI (`components/ui/` is shadcn, untouched). `lib/`: hooks and pure helpers. `api/`: backend types per area plus `client.ts`. `app/`: the shell and routes.
- Only move something to `features/`, `components/` or `lib/` once a second place uses it.
- One component per file, named after its export, with names that say what it shows (`BoardCard`, not `Card`). A private helper under ~15 lines used by one component can stay in that file.
- Folders are kebab-case. Component files are PascalCase, hooks and helpers camelCase (`useWidth.ts`, `format.ts`, `constants.ts`). Named exports everywhere except pages, and no `index.ts` barrels.
- Imports: `./` inside a folder, `@/...` for anything else (no `../`).
- Aim for ~150 lines per file; split before a file grows well past that.

## Checks

- Backend: `cd backend && uv run ruff check src tests && uv run ruff format src tests && uv run pytest -q` (the Postgres tests use a throwaway `jobtracker_test` database on port 5433 and skip if it isn't running).
- Frontend: `cd frontend && npm run typecheck`.
- Migrations in `backend/src/jobtracker/adapters/db/migrations/` must stay DSQL-compatible: one statement per transaction, idempotent, no arrays, triggers or sequences.
