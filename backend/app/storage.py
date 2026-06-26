from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

from app import cooklang
from app.models import RecipeDetail, RecipeSummary


class StorageError(ValueError):
    pass


@dataclass
class RecipeRepository:
    app_base_url: str
    recipe_root: Path
    recipes: dict[str, RecipeDetail] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.recipe_root.mkdir(parents=True, exist_ok=True)
        self.refresh()

    def refresh(self) -> None:
        self.recipes = {}
        for path in sorted(self.recipe_root.rglob("*.cook")):
            slug = path.relative_to(self.recipe_root).with_suffix("").as_posix()
            self.recipes[slug] = self._read_recipe(path, slug)

    def list_recipes(self) -> list[RecipeSummary]:
        self.refresh()
        return sorted(
            (summary_from_detail(recipe) for recipe in self.recipes.values()),
            key=lambda recipe: recipe.title.casefold(),
        )

    def get_recipe(self, slug: str, scaled_servings: float | None = None) -> RecipeDetail:
        self.refresh()
        if slug not in self.recipes:
            raise StorageError("Recipe not found")

        recipe = self.recipes[slug]
        if scaled_servings is None:
            return recipe

        metadata, body = cooklang.parse_document(recipe.content)
        return recipe.model_copy(
            update={
                "ingredients": cooklang.parse_ingredients(
                    body, scale=scaled_servings, servings=recipe.servings
                )
            }
        )

    def write_recipe(self, slug: str, content: str) -> RecipeDetail:
        path = self.recipe_path(slug)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        self.refresh()
        return self.get_recipe(slug)

    def update_metadata(
        self,
        slug: str,
        *,
        bookmarked: bool | None = None,
        image: str | None = None,
        servings: float | None = None,
        tags: list[str] | None = None,
    ) -> RecipeDetail:
        recipe = self.get_recipe(slug)
        metadata, body = cooklang.parse_document(recipe.content)
        updated_metadata = cooklang.set_metadata_values(
            metadata, bookmarked=bookmarked, image=image, servings=servings, tags=tags
        )
        return self.write_recipe(slug, cooklang.render_document(updated_metadata, body))

    def delete_recipe(self, slug: str) -> None:
        path = self.recipe_path(slug)
        if not path.exists():
            raise StorageError("Recipe not found")
        path.unlink()
        self.refresh()

    def recipe_path(self, slug: str) -> Path:
        return safe_child(self.recipe_root, slug, ".cook")

    def _read_recipe(self, path: Path, slug: str) -> RecipeDetail:
        content = path.read_text(encoding="utf-8")
        metadata, body = cooklang.parse_document(content)
        title = cooklang.metadata_title(metadata, path.stem)
        servings = cooklang.metadata_servings(metadata)
        return RecipeDetail(
            bookmarked=cooklang.metadata_bookmarked(metadata),
            content=content,
            cook_time=cooklang.metadata_cook_time(metadata),
            cookware=cooklang.parse_cookware(body),
            image=cooklang.metadata_image(metadata),
            ingredients=cooklang.parse_ingredients(body, servings=servings),
            metadata=metadata,
            notes=cooklang.parse_notes(metadata, body),
            original_url=cooklang.metadata_original_url(metadata),
            public_url=f"{self.app_base_url.rstrip('/')}/recipes/{quote(slug)}",
            servings=servings,
            slug=slug,
            steps=cooklang.parse_steps(body),
            tags=cooklang.metadata_tags(metadata),
            timers=cooklang.parse_timers(body),
            title=title,
        )

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


def safe_child(root: Path, slug: str, suffix: str) -> Path:
    if not slug or slug.startswith("/") or ".." in Path(slug).parts:
        raise StorageError("Invalid path")
    path = (root / slug).with_suffix(suffix).resolve()
    root_resolved = root.resolve()
    if root_resolved not in path.parents:
        raise StorageError("Invalid path")
    return path
