# Job application tracker

Local app (docker compose): FastAPI + Postgres backend in `backend/`, React + Vite + Tailwind/shadcn frontend in `frontend/`. `docs/plan.md` lists only the open work: remove an item once it's done. The design decisions and history of what's built are in git (`git show 95af9fb:docs/plan.md`); read the relevant section before changing a feature.

## How we work

- **The user reviews the frontend themselves.** Typecheck and build the frontend (`npm run typecheck`, `npm run build` in `frontend/`), then hand it over for review. Don't use the Chrome extension or the user's browser.
- **A PR that changes the UI shows it**, as described in "PR captures" below, within 5 minutes. Past that, stop and write the fallback instead. PRs without UI changes skip this.

## PR captures

The repo is public, so a capture shows only fake data: the worktree's own stack (`scripts/worktree-env.sh`, `docker compose up -d`, `docker compose exec api jobtracker dev seed`, fake rows added to that database if a page needs more). Never the real local `jobtracker` database or prod. Local mode has no login.

1. Note the start time. The whole capture, starting the stack included, gets 5 minutes.
2. Playwright in a scratch folder (`npx -y playwright` or a scratch `npm i playwright`; never add it to `frontend/package.json`); Chromium is usually already in `~/Library/Caches/ms-playwright`. One PNG per changed screen, and a short GIF only when the change is an interaction: a series of `page.screenshot()` frames joined with the system `ffmpeg` (`/opt/homebrew/bin/ffmpeg`), not Playwright's video recording, which needs a version-specific ffmpeg download. Look at each image before uploading.
3. Upload to the `pr-media` branch (no shared history with `main`, never merged) under `pr-<number>/`, one file per call: `gh api -X PUT repos/{owner}/{repo}/contents/pr-<number>/<file> -f message="PR #<number> media" -f branch=pr-media -f content="$(base64 -i <file>)"`. Link it in the PR body as `![what it shows](https://github.com/{owner}/{repo}/blob/pr-media/pr-<number>/<file>?raw=true)`.
4. **Fallback** when the time runs out or something blocks: a "How to see it" section in the PR: the route, how to get the data there, what to click, and what to look for. Say why there's no capture.
- Build in phases and stop for review at the end of each one.
- Ask before anything that reads the real Gmail inbox or Google Calendar, touches AWS, or costs money (LLM calls). The app stays local for now.
- Never mutate the real local `jobtracker` database while testing. Use the test suite, or a throwaway database.
- In a git worktree (Orca and other agents), run `scripts/worktree-env.sh` before any `docker compose` command. Without it, compose replaces the main checkout's stack, which serves the real database. Details: `docs/setup.md` "Several worktrees at once".
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
