# Recipes

A small Cooklang filesystem recipe app.

- Public users can browse, search, share, and view recipes.
- Editor users can sign in with env-configured credentials to create, import, edit, tag, and bookmark recipes.
- Recipes are stored as plain-text `.cook` files under `/data/recipes/{slug}/recipe.cook`.
- Uploaded images and source files live next to each recipe as `image.*` / `source.*`.

## Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.12, FastAPI, Uvicorn |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Editor | TipTap (Cooklang body editing) |
| Client data | IndexedDB + TanStack Query (offline-first sync) |
| Import | Fireworks AI (HTML/PDF/DOCX → Cooklang) |
| Deploy | Docker Compose, Caddy reverse proxy |

## Project layout

```text
backend/app/          FastAPI app, Cooklang parsing, import pipeline, storage
backend/tests/        pytest suite
frontend/src/         React SPA (pages, components, sync, API client)
frontend/public/      Static assets, service worker
scripts/              One-off data/import utilities
pyproject.toml        Python package and pytest config
docker-compose.yml    Production-style single-container deploy
docker-compose.dev.yml  Hot-reload dev stack (Vite + Uvicorn)
```

Code conventions live in [AGENTS.md](./AGENTS.md), [backend/CONTRIBUTING.md](./backend/CONTRIBUTING.md), and [frontend/CONTRIBUTING.md](./frontend/CONTRIBUTING.md).

Future work: [docs/SAAS_PLAN.md](./docs/SAAS_PLAN.md) — notes on multi-user / SaaS migration (tenancy, storage, auth).

## Local Development

Docker hot reload:

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

Open the frontend at `http://localhost:5173`. The Vite dev server proxies API requests to
the backend container, so frontend changes reload without rebuilding the production image and
backend changes reload through Uvicorn. The backend is also exposed directly at
`http://localhost:8001`.

Backend:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --app-dir backend
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Copy `.env.example` to `.env` and change `RECIPE_EDITOR_PASSWORD` and `SESSION_SECRET`.

## Data Layout

```text
/data/
  recipes/
    chili/
      recipe.cook
      source.pdf       # optional uploaded source
      image.jpg        # optional uploaded image
  ingredients.json      Ingredient catalog (densities, aliases)
  import_models.json    Fireworks model IDs (edited in Settings)
  image_queue.json      Deferred remote image scrape queue
```

Recipe metadata follows Cooklang front matter conventions:

```cook
---
title: Chili
tags:
  - dinner
bookmarked: false
servings: 6
image: image.jpg
source: source.txt
prep time: 15 minutes
cook time: 45 minutes
description: Good freezer meal.
---

Brown @beef{1%lb}.
```

Local `source.*` / `image.*` refs are relative to the recipe folder (no slug in the path), so
renaming a recipe directory does not require rewriting metadata. HTTP(S) URLs are also allowed.
## Offline sync

The frontend caches recipes and the ingredient catalog in IndexedDB and syncs from `/api/sync/*`
endpoints. A service worker is registered in production builds for basic offline support.

## Recipe import

Editors can import recipes from a URL, file upload (HTML, PDF, DOCX, Markdown, plain text), or
camera capture. The backend fetches or extracts source text, sends it to Fireworks AI with a
Cooklang system prompt, and returns a preview for mapping ingredients before save.

Remote recipe images are not scraped on the request path (except when the import already has HTML
with `og:image`, or a URL import that already fetched the page). Missing images are marked
`image_pending` and filled by the `image-worker` Compose service, which scrapes politely across
distinct hosts. When a host blocks scraping (and Iframely cannot recover an image), that host is
marked blocked in `image_queue.json` and remaining jobs for it are abandoned — no cooldown retries.
Seed existing gaps with:

```bash
python scripts/backfill_recipe_images.py --enqueue-missing
```

Set `FIREWORKS_API_KEY` in `.env` for import to work. Choose Fireworks model IDs in
**Settings → Import models** (stored under `/data/import_models.json`). Token limits remain
env-configurable via `IMPORT_MAX_*` (see `.env.example`).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `APP_BASE_URL` | Public URL used in recipe links and redirects |
| `COOKIE_SECURE` | Set `true` in production (HTTPS) |
| `DATA_ROOT` | Root data directory inside the container (`/data`) |
| `FRONTEND_DIST` | Built frontend static files path |
| `HOST_DATA_ROOT` | Host path mounted to `DATA_ROOT` in Compose |
| `RECIPE_EDITOR_USERNAME` / `RECIPE_EDITOR_PASSWORD` | Editor login credentials |
| `SESSION_SECRET` | Signed session cookie secret |
| `FIREWORKS_API_KEY` | Fireworks API key for recipe import |
| `IFRAMELY_API_KEY` | Optional Iframely key for image scrape fallback on 403/429 |
| `IMPORT_MODEL_TEXT` / `IMPORT_MODEL_VISION` / `IMPORT_MODEL_REPAIR` / `IMPORT_MODEL_BULK` | Optional bootstrap defaults until models are saved in Settings |
| `IMPORT_MAX_SOURCE_CHARS` / `IMPORT_MAX_OUTPUT_TOKENS` | Import size limits |
| `PAGE_FETCH_*` | Direct page-fetch retries, concurrency, and spacing |
| `IMAGE_QUEUE_CONCURRENCY` | Max parallel image scrapes (distinct hosts only) |
| `IMAGE_QUEUE_HOST_GAP_SECONDS` | Minimum gap between requests to the same host |
| `IMAGE_QUEUE_HOST_COOLDOWN_SECONDS` | Unused for blocks (hosts are marked blocked once); kept for compatibility |
| `IMAGE_QUEUE_MAX_ATTEMPTS` | Give up and clear `image_pending` after N non-block failures |

## Docker

```bash
cp .env.example .env
docker compose up --build
```

This is the production-style route. It builds the frontend into static files and serves them from
the Python container, so frontend changes require rebuilding the image.

The Compose service joins the external `personal-infra-shared` network and mounts:

```text
${HOST_DATA_ROOT:-/srv/apps/recipes/data}:/data
```

## Caddy

Add this to the real Caddyfile in `personal-infra`:

```caddyfile
recipes.grantlonie.com {
	reverse_proxy recipes:8000
}
```

## Checks

```bash
pytest
ruff check backend/app && ruff format --check backend/app
cd frontend && npm run build && npm run format
docker build .
```
