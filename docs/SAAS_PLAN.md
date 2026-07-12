# SaaS migration plan

Planning notes for extending this project into a multi-user SaaS product. Captured from an architecture discussion — not a commitment to implement.

## Current state

This app is a **single-tenant personal recipe site**:

| Area | Today |
|------|-------|
| **Storage** | Per-recipe folders under `/data/recipes/{slug}/` (`recipe.cook` plus optional `source.*` / `image.*`), shared `ingredients.json` |
| **Auth** | One editor account from env (`RECIPE_EDITOR_USERNAME` / `RECIPE_EDITOR_PASSWORD`) with a signed session cookie |
| **Access** | All recipes are public; only writes require login |
| **User data** | `bookmarked` is recipe metadata in the `.cook` file — not per user |
| **Server index** | In-memory `RecipeRepository` cache, filesystem scan on startup |
| **Client** | IndexedDB mirrors the full global recipe set for offline sync |

Key code paths:

- `backend/app/storage.py` — filesystem CRUD + in-memory index
- `backend/app/auth.py` — single shared editor session
- `frontend/src/sync.ts` + `frontend/src/db.ts` — global offline cache

## Goal

Support **multiple users** (and likely **shared workspaces**) with proper isolation, per-user preferences, and infrastructure that can scale beyond a single mounted volume.

---

## Open decision: tenancy model

Pick this first — it drives schema, API design, and billing.

| Model | Description | Good for |
|-------|-------------|----------|
| **Personal workspace** | Each user owns their own recipe namespace | Individual cookbook apps |
| **Shared household / team** | Multiple users share one recipe collection | Family or small-team cooking |
| **Hybrid** | Personal recipes + shared cookbooks | Flexible product, more complexity |

Related questions:

- Are recipes **private by default**, or public like today?
- Can users **share** individual recipes or whole cookbooks via link?
- Is there a **public gallery** or discovery surface?

---

## What needs to happen

### 1. Identity and authentication

Replace the env-configured single editor with real accounts:

- Sign up, login, password reset (and/or OAuth: Google, Apple, etc.)
- Per-user sessions (cookies or JWT if mobile/API-first)
- Optional: email verification, 2FA

`backend/app/auth.py` grows from credential comparison against env vars to a user store and proper password handling.

### 2. Authorization (not just authentication)

Today: authenticated = can edit anything.

SaaS needs:

- Can this user **read** this recipe? (private / shared / public)
- Can this user **edit or delete** it? (owner, editor, viewer roles)
- All API routes scoped to workspace or user context

### 3. Per-user state

Move user-specific data off recipe files:

| Today (on recipe) | SaaS (per user or per user+recipe) |
|-------------------|-------------------------------------|
| `bookmarked` in front matter | `user_recipe_bookmarks` table |
| — | recently viewed, personal filters |
| — | meal plans, shopping lists (if added later) |

### 4. Storage scoping

Every persisted resource needs a tenant/workspace key:

- Recipes (today: global slug like `chili` → `recipes/chili/recipe.cook`)
- Ingredient catalog (today: one shared `ingredients.json`)
- Source/image uploads (today: next to the recipe as `recipes/{slug}/source.*` / `image.*`)

Slug uniqueness becomes `{workspace_id}/weeknight/chili`, or opaque IDs with slug as a display field.

### 5. Sharing and visibility

Today all reads are public. SaaS typically needs:

- Private by default
- Unlisted share links
- Optional public profile or cookbook gallery

### 6. Infrastructure and operations

- Durable storage that works across multiple app instances (not a single host volume)
- Horizontal scaling — in-memory `RecipeRepository` cache does not work across servers without a shared index or database
- Object storage (S3, R2, etc.) for uploaded images and source files
- Background jobs for import / LLM work (today likely synchronous per request)
- Rate limiting on import and auth endpoints
- Backups, monitoring, tenant-aware logging

### 7. Frontend changes

- Registration and login flows
- Workspace switcher (if multi-workspace)
- IndexedDB sync scoped per user/workspace — cannot sync the entire server catalog
- Bookmark UI backed by per-user API, not recipe file metadata

### 8. Commercial SaaS (if charging)

- Stripe (or similar) subscriptions
- Usage limits: imports/month, storage, seats per workspace
- Admin tooling, GDPR export/delete

---

## Storage: filesystem vs database?

**Separate the format from the backend.** Keep **Cooklang as the canonical content format** regardless of where it is stored. The question is how to persist and query it at SaaS scale.

### Option A: Stay filesystem-based

```text
/data/{workspace_id}/recipes/{slug}/recipe.cook
/data/{workspace_id}/recipes/{slug}/source.*
/data/{workspace_id}/recipes/{slug}/image.*
/data/{workspace_id}/ingredients.json
```

**Pros**

- Smallest change to `RecipeRepository` and `cooklang.py`
- Recipes stay plain text — easy export, git, human editing
- Strong "portable cookbook" product story

**Cons**

- Multi-instance deploys need shared filesystem (EFS/NFS) or sticky sessions
- Search, filtering, and permissions still need a separate index
- Per-user bookmarks need a database anyway
- Slug collisions, renames, and cross-tenant queries are awkward
- Backup/restore and migrations harder than managed DB

**When it fits:** small scale, few tenants, or **one deployment per customer** (hosted personal instances, not true multi-tenant).

### Option B: Document database (MongoDB, etc.)

Store each recipe as a document: `{ workspaceId, slug, title, tags, content: "---\n...\n---\n..." }`.

**Pros**

- Natural multi-tenant scoping and indexing
- Flexible schema for metadata

**Cons**

- Users, memberships, and bookmarks are relational — you may end up with both a doc store and SQL
- Lose trivial "files on disk" portability unless you add export

**When it fits:** recipe bodies are large and highly variable; less ideal when users/permissions/sharing are central.

### Option C: PostgreSQL (recommended default)

| Store | Purpose |
|-------|---------|
| `users`, `workspaces`, `memberships` | Identity and tenancy |
| `recipes.content` (TEXT) | Full Cooklang document as text |
| JSONB or dedicated columns | title, tags, servings, etc. for fast queries |
| `user_recipe_bookmarks` | Per-user bookmarks |
| `recipe_shares` | Share links, visibility |

**Pros**

- Users, permissions, bookmarks, and recipes in one system
- Full-text search on title + content (Postgres FTS)
- Cooklang string remains source of truth; parse on read/write as today
- Export to `.cook` is a download endpoint, not the primary storage model

**Cons**

- Migration work from filesystem `RecipeRepository`
- Index metadata columns, not the full body

### Option D: Hybrid

- **PostgreSQL** — users, workspaces, ACLs, bookmarks, search index, recipe metadata
- **S3/R2** — uploaded source files and images
- **Recipe `content`** — Postgres TEXT or object storage as `{id}.cook` with metadata in DB

---

## Recommendation

| Scale / goal | Approach |
|--------------|----------|
| Few users, hosted personal instances | Filesystem per deployment can still work |
| True multi-tenant SaaS with sharing, search, billing | **PostgreSQL + object storage**, keep Cooklang as serialized format |
| Document DB only | Reasonable for recipe blobs; still likely need SQL for users and permissions |

For a multi-user SaaS: **keep Cooklang, move tenancy and indexing to a database.** Pure filesystem only makes sense at small scale or with isolated instances per customer.

---

## Suggested migration path

Incremental — no big-bang rewrite required.

### Phase 0 — Decide tenancy model

Answer: personal vs household vs hybrid; default visibility; sharing model.

### Phase 1 — Storage abstraction

`RecipeRepository` already acts like an interface. Introduce a protocol/ABC and keep filesystem as the first implementation so a DB backend can be swapped in.

### Phase 2 — Users and workspaces

Add user accounts and workspace concept. Even if recipes still live on disk, scope paths by `workspace_id`:

```text
/data/{workspace_id}/recipes/...
```

### Phase 3 — Per-user bookmarks

Move `bookmarked` off recipe front matter into a `user_recipe_bookmarks` table. First clear signal the data model has outgrown single-user metadata.

### Phase 4 — Visibility and authorization

Add `visibility` (private / shared / public) and enforce on all read/write routes. Replace "authenticated = editor of everything."

### Phase 5 — Rework client sync

Scope IndexedDB by workspace. Delta sync per tenant instead of global manifest.

### Phase 6 — Migrate content to database

When filesystem pain appears (search, scale, ops): move recipe `content` to Postgres TEXT (or object store), keep Cooklang parse/render pipeline unchanged.

### Phase 7 — Production SaaS ops

Object storage for assets, background import jobs, rate limits, billing, backups.

---

## Rough schema sketch (PostgreSQL)

For when Phase 2+ begins — adjust after tenancy decision.

```sql
-- Identity
users (id, email, password_hash, created_at)
workspaces (id, name, slug, created_at)
memberships (user_id, workspace_id, role)  -- owner | editor | viewer

-- Recipes
recipes (
  id,
  workspace_id,
  slug,           -- unique per workspace
  title,
  content,        -- full Cooklang document (TEXT)
  servings,
  cook_time,
  image_url,
  original_url,
  visibility,     -- private | unlisted | public
  created_at,
  updated_at
)
recipe_tags (recipe_id, tag)

-- Per-user
user_recipe_bookmarks (user_id, recipe_id, created_at)

-- Sharing
recipe_shares (recipe_id, token, expires_at)  -- optional unlisted links

-- Ingredients (workspace-scoped or global catalog TBD)
ingredient_catalogs (workspace_id, version, data JSONB)
```

---

## Files likely to change

| Area | Files |
|------|-------|
| Auth | `backend/app/auth.py`, `frontend/src/AuthContext.tsx` |
| Storage | `backend/app/storage.py`, `backend/app/config.py` |
| API | `backend/app/main.py` — scope all routes |
| Models | `backend/app/models.py` — workspace/user fields |
| Sync | `frontend/src/sync.ts`, `frontend/src/db.ts` |
| Bookmarks | `backend/app/cooklang.py`, `frontend/src/HomePage.tsx`, `RecipePage.tsx` |
| Deploy | `docker-compose.yml`, new DB service, object storage config |

---

## Next conversation starters

- [ ] Choose tenancy model (personal / household / hybrid)
- [ ] Choose default visibility (private vs public)
- [ ] Confirm PostgreSQL + object storage vs filesystem-per-workspace for v1
- [ ] Sketch API changes (`/api/workspaces/{id}/recipes` vs session-scoped)
- [ ] Decide auth provider (email/password, OAuth, or both)
- [ ] Define MVP scope: accounts + private recipes only, or sharing from day one?
