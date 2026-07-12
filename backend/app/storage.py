from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

from app import cooklang
from app.models import ManifestEntry, RecipeDetail, RecipeSummary, SyncManifest
from app.sources import RECIPE_FILENAME, delete_recipe_dir, rename_recipe_dir


class StorageError(ValueError):
    pass


def summary_from_detail(recipe: RecipeDetail) -> RecipeSummary:
    return RecipeSummary(
        bookmarked=recipe.bookmarked,
        cook_time=recipe.cook_time,
        image=recipe.image,
        notes=recipe.notes,
        original_url=recipe.original_url,
        servings=recipe.servings,
        slug=recipe.slug,
        tags=recipe.tags,
        title=recipe.title,
    )


def safe_recipe_dir(root: Path, slug: str) -> Path:
    if not slug or slug.startswith("/") or ".." in Path(slug).parts:
        raise StorageError("Invalid path")
    path = (root / slug).resolve()
    if path.parent != root.resolve():
        raise StorageError("Invalid path")
    return path


@dataclass
class RecipeRepository:
    app_base_url: str
    recipe_root: Path
    recipes: dict[str, RecipeDetail] = field(default_factory=dict)
    _mtimes: dict[str, float] = field(default_factory=dict, repr=False)
    version: int = 0

    def __post_init__(self) -> None:
        self.recipe_root.mkdir(parents=True, exist_ok=True)
        self.sync_index()

    def sync_index(self) -> None:
        seen: set[str] = set()
        changed = False

        for path in sorted(self.recipe_root.glob(f"*/{RECIPE_FILENAME}")):
            slug = path.parent.name
            seen.add(slug)
            mtime = path.stat().st_mtime
            if slug not in self._mtimes or self._mtimes[slug] != mtime:
                self.recipes[slug] = self._read_recipe(path, slug)
                self._mtimes[slug] = mtime
                changed = True

        for slug in list(self.recipes.keys()) + list(self._mtimes.keys()):
            if slug in seen:
                continue
            if slug in self.recipes or slug in self._mtimes:
                self.recipes.pop(slug, None)
                self._mtimes.pop(slug, None)
                changed = True

        if changed:
            self.version += 1

    def sync_slug(self, slug: str) -> RecipeDetail:
        path = self.recipe_path(slug)
        if not path.exists():
            raise StorageError("Recipe not found")

        mtime = path.stat().st_mtime
        if slug not in self.recipes or self._mtimes.get(slug) != mtime:
            self.recipes[slug] = self._read_recipe(path, slug)
            self._mtimes[slug] = mtime
            self.version += 1
        return self.recipes[slug]

    def list_recipes(self) -> list[RecipeSummary]:
        self.sync_index()
        return sorted(
            (summary_from_detail(recipe) for recipe in self.recipes.values()),
            key=lambda recipe: recipe.title.casefold(),
        )

    def list_all_details(self) -> list[RecipeDetail]:
        self.sync_index()
        return [self.recipes[slug] for slug in sorted(self.recipes)]

    def manifest(self) -> SyncManifest:
        self.sync_index()
        return SyncManifest(
            version=self.version,
            recipes=[
                ManifestEntry(
                    slug=slug,
                    updated_at=datetime.fromtimestamp(self._mtimes[slug], UTC).isoformat(),
                )
                for slug in sorted(self.recipes)
            ],
        )

    def get_recipe(self, slug: str, scaled_servings: float | None = None) -> RecipeDetail:
        recipe = self.sync_slug(slug)
        if scaled_servings is None:
            return recipe

        metadata, body = cooklang.parse_document(recipe.content)
        return recipe.model_copy(
            update={
                "ingredients": cooklang.parse_ingredients(
                    body, scale=scaled_servings, servings=recipe.servings
                ),
                "blocks": cooklang.scale_blocks(
                    recipe.blocks, scale=scaled_servings, servings=recipe.servings
                ),
            }
        )

    def write_recipe(
        self, slug: str, content: str, *, previous_slug: str | None = None
    ) -> RecipeDetail:
        if previous_slug and previous_slug != slug:
            rename_recipe_dir(self.recipe_root, previous_slug, slug)
            content = _rewrite_asset_paths(content, previous_slug, slug)

        path = self.recipe_path(slug)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            content = cooklang.normalize_document(content)
        except ValueError as error:
            raise StorageError(str(error)) from error
        path.write_text(content, encoding="utf-8")
        mtime = path.stat().st_mtime
        self.recipes[slug] = self._read_recipe(path, slug)
        self._mtimes[slug] = mtime
        if previous_slug and previous_slug != slug:
            self.recipes.pop(previous_slug, None)
            self._mtimes.pop(previous_slug, None)
        self.version += 1
        return self.recipes[slug]

    def update_metadata(
        self,
        slug: str,
        *,
        bookmarked: bool | None = None,
        image: str | None = None,
        servings: float | None = None,
        tags: list[str] | None = None,
    ) -> RecipeDetail:
        recipe = self.sync_slug(slug)
        metadata, body = cooklang.parse_document(recipe.content)
        updated_metadata = cooklang.set_metadata_values(
            metadata, bookmarked=bookmarked, image=image, servings=servings, tags=tags
        )
        return self.write_recipe(slug, cooklang.render_document(updated_metadata, body))

    def delete_recipe(self, slug: str) -> None:
        path = self.recipe_path(slug)
        if not path.exists():
            raise StorageError("Recipe not found")
        delete_recipe_dir(self.recipe_root, slug)
        self.recipes.pop(slug, None)
        self._mtimes.pop(slug, None)
        self.version += 1

    def recipe_path(self, slug: str) -> Path:
        return safe_recipe_dir(self.recipe_root, slug) / RECIPE_FILENAME

    def _read_recipe(self, path: Path, slug: str) -> RecipeDetail:
        content = path.read_text(encoding="utf-8")
        metadata, body = cooklang.parse_document(content)
        title = cooklang.metadata_title(metadata, slug)
        servings = cooklang.metadata_servings(metadata)
        return RecipeDetail(
            bookmarked=cooklang.metadata_bookmarked(metadata),
            content=content,
            cook_time=cooklang.metadata_cook_time(metadata),
            cookware=cooklang.parse_cookware(body),
            image=cooklang.resolve_image_url(metadata, self.app_base_url),
            ingredients=cooklang.parse_ingredients(body, servings=servings),
            metadata=metadata,
            notes=cooklang.parse_notes(metadata, body),
            original_url=cooklang.metadata_original_url(metadata),
            public_url=f"{self.app_base_url.rstrip('/')}/recipes/{quote(slug)}",
            servings=servings,
            slug=slug,
            blocks=cooklang.parse_blocks(body),
            tags=cooklang.metadata_tags(metadata),
            timers=cooklang.parse_timers(body),
            title=title,
        )


def _rewrite_asset_paths(content: str, old_slug: str, new_slug: str) -> str:
    metadata, body = cooklang.parse_document(content)
    for key in ("source", "image"):
        value = cooklang.parse_ref_value(metadata, key)
        if value and value.startswith(f"recipes/{old_slug}/"):
            metadata[key] = value.replace(f"recipes/{old_slug}/", f"recipes/{new_slug}/", 1)
    return cooklang.render_document(metadata, body)
