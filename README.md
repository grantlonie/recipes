# Recipes

A small Cooklang filesystem recipe app.

- Public users can browse, search, share, and view recipes.
- Editor users can sign in with env-configured credentials to create, import, edit, tag, and group recipes.
- Recipes are stored as plain-text `.cook` files under `/data/recipes`.
- Groups are stored as plain-text `.menu` files under `/data/groups`.
- Images are not stored by the app. Recipe `image` metadata should be a public URL.

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
    weeknight/chili.cook
  groups/
    favorites.menu
```

Recipe metadata follows Cooklang front matter conventions:

```cook
---
title: Chili
tags:
  - dinner
servings: 6
image: https://example.com/chili.jpg
source: https://example.com/original-recipe
time: 1 hour
description: Good freezer meal.
---

Brown @beef{1%lb}.
```

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

## URL Import

The protected import endpoint runs `cooklang-import <url>` on the server. Install or include
`cooklang-import` in the runtime environment before using URL import. If it is missing, the import
UI will show a server error while the rest of the app continues to work.

## Checks

```bash
pytest
cd frontend && npm run build && npm run format
docker build .
```
