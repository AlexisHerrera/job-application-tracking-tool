# Job application tracker

Local app (docker compose): FastAPI + Postgres backend in `backend/`, React + Vite + Tailwind/shadcn frontend in `frontend/`. Design decisions and their history live in `docs/plan.md`; read the relevant section before changing a feature.

## How we work

- **The user reviews the frontend themselves.** Don't take screenshots, drive a browser, or use the Chrome extension to check UI work. Typecheck and build the frontend (`npm run typecheck`, `npm run build` in `frontend/`), then hand it over for review.
- Build in phases and stop for review at the end of each one (`docs/plan.md` §9).
- Ask before anything that reads the real Gmail inbox or Google Calendar, touches AWS, or costs money (LLM calls). The app stays local for now.
- Never mutate the real local `jobtracker` database while testing. Use the test suite, or a throwaway database.

## Checks

- Backend: `cd backend && uv run ruff check src tests && uv run ruff format src tests && uv run pytest -q` (the Postgres tests use a throwaway `jobtracker_test` database on port 5433 and skip if it isn't running).
- Frontend: `cd frontend && npm run typecheck`.
- Migrations in `backend/src/jobtracker/adapters/db/migrations/` must stay DSQL-compatible: one statement per transaction, idempotent, no arrays, triggers or sequences.
