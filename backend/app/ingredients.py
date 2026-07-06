from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from app.models import CatalogIngredient, IngredientCatalog

SEED_PATH = Path(__file__).with_name("ingredients_seed.json")


class IngredientStorageError(ValueError):
    pass


@dataclass
class IngredientRepository:
    catalog_path: Path
    catalog: IngredientCatalog = field(default_factory=lambda: IngredientCatalog(version=0, ingredients=[]))

    def __post_init__(self) -> None:
        self.ensure_catalog()

    def ensure_catalog(self) -> IngredientCatalog:
        self.catalog_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.catalog_path.exists():
            seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
            self.catalog_path.write_text(json.dumps(seed, indent=2) + "\n", encoding="utf-8")
        self.catalog = self._read()
        return self.catalog

    def get_catalog(self) -> IngredientCatalog:
        if not self.catalog_path.exists():
            return self.ensure_catalog()
        mtime = self.catalog_path.stat().st_mtime
        if getattr(self, "_mtime", None) != mtime:
            self.catalog = self._read()
            self._mtime = mtime
        return self.catalog

    def list_ingredients(self) -> list[CatalogIngredient]:
        return sorted(self.get_catalog().ingredients, key=lambda item: item.name.casefold())

    def find_by_name(self, name: str) -> CatalogIngredient | None:
        key = name.casefold().strip()
        for ingredient in self.get_catalog().ingredients:
            if ingredient.name.casefold() == key:
                return ingredient
            if any(alias.casefold() == key for alias in ingredient.aliases):
                return ingredient
        return None

    def upsert(self, ingredient: CatalogIngredient) -> CatalogIngredient:
        name = ingredient.name.strip()
        if not name:
            raise IngredientStorageError("Ingredient name is required")

        catalog = self.get_catalog()
        cleaned = CatalogIngredient(
            name=name,
            density_kg_m3=ingredient.density_kg_m3,
            aliases=_clean_aliases(ingredient.aliases, name),
        )
        ingredients = [item for item in catalog.ingredients if item.name.casefold() != name.casefold()]
        ingredients.append(cleaned)
        self._write(IngredientCatalog(version=catalog.version + 1, ingredients=ingredients))
        return cleaned

    def delete(self, name: str) -> None:
        catalog = self.get_catalog()
        key = name.casefold().strip()
        ingredients = [item for item in catalog.ingredients if item.name.casefold() != key]
        if len(ingredients) == len(catalog.ingredients):
            raise IngredientStorageError("Ingredient not found")
        self._write(IngredientCatalog(version=catalog.version + 1, ingredients=ingredients))

    def _read(self) -> IngredientCatalog:
        payload = json.loads(self.catalog_path.read_text(encoding="utf-8"))
        catalog = IngredientCatalog.model_validate(payload)
        self._mtime = self.catalog_path.stat().st_mtime
        return catalog

    def _write(self, catalog: IngredientCatalog) -> None:
        self.catalog_path.parent.mkdir(parents=True, exist_ok=True)
        payload = catalog.model_dump()
        self.catalog_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        self.catalog = catalog
        self._mtime = self.catalog_path.stat().st_mtime


def _clean_aliases(aliases: list[str], name: str) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    name_key = name.casefold()
    for alias in aliases:
        value = alias.strip()
        key = value.casefold()
        if not value or key == name_key or key in seen:
            continue
        seen.add(key)
        cleaned.append(value)
    return cleaned
