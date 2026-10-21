from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from app.config import Settings

FIREWORKS_DASHBOARD_URL = "https://app.fireworks.ai"
FIREWORKS_MODELS_URL = "https://fireworks.ai/models"


@dataclass(frozen=True)
class ImportModelSettings:
    bulk: str
    repair: str
    text: str
    vision: str


class ImportModelStorageError(ValueError):
    pass


def defaults_from_settings(settings: Settings) -> ImportModelSettings:
    return ImportModelSettings(
        bulk=settings.import_model_bulk.strip(),
        repair=settings.import_model_repair.strip(),
        text=settings.import_model_text.strip(),
        vision=settings.import_model_vision.strip(),
    )


def resolve_import_models(settings: Settings) -> ImportModelSettings:
    path = settings.import_models_path
    if not path.exists():
        return defaults_from_settings(settings)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return defaults_from_settings(settings)
    if not isinstance(raw, dict):
        return defaults_from_settings(settings)
    defaults = defaults_from_settings(settings)
    return ImportModelSettings(
        bulk=_clean_model(raw.get("bulk"), defaults.bulk),
        repair=_clean_model(raw.get("repair"), defaults.repair),
        text=_clean_model(raw.get("text"), defaults.text),
        vision=_clean_model(raw.get("vision"), defaults.vision),
    )


def save_import_models(settings: Settings, models: ImportModelSettings) -> ImportModelSettings:
    cleaned = ImportModelSettings(
        bulk=_require_model(models.bulk, "bulk"),
        repair=_require_model(models.repair, "repair"),
        text=_require_model(models.text, "text"),
        vision=_require_model(models.vision, "vision"),
    )
    path = settings.import_models_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(cleaned), indent=2) + "\n", encoding="utf-8")
    return cleaned


def _clean_model(value: object, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _require_model(value: str, field: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ImportModelStorageError(f"Import model '{field}' is required")
    return cleaned
