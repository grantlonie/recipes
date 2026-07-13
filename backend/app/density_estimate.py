from __future__ import annotations

import json
import re
from typing import Any

from openai import APIStatusError

from app.config import Settings
from app.fireworks_llm import LLMError, create_client, reasoning_extra_body, strip_think_blocks
from app.models import DensityEstimate

_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)
_SYSTEM_PROMPT = """\
You estimate bulk densities for cooking ingredients in kg/m³ (same numeric scale as g/L).
Reference points: water=1000, milk≈1030, all-purpose flour≈530, granulated sugar≈850, \
butter≈910, honey≈1420, olive oil≈910, brown sugar (packed)≈930, cocoa powder≈500.

Return JSON only in this shape:
{"estimates":[{"name":"<ingredient>","density_kg_m3":530}]}

Rules:
- Use the same ingredient names provided (do not rename).
- Round density_kg_m3 to the nearest 10.
- Set density_kg_m3 to null for items where cup/volume conversion is not meaningful \
(whole meat cuts, eggs by count, whole vegetables counted as pieces, packages, etc.).
- Prefer typical kitchen bulk density (scooped/poured), not absolute solid density.
"""


def estimate_ingredient_densities(
    *,
    settings: Settings,
    names: list[str],
) -> list[DensityEstimate]:
    cleaned = _unique_names(names)
    if not cleaned:
        return []
    if not settings.fireworks_api_key.strip():
        raise LLMError("FIREWORKS_API_KEY is not configured")

    client = create_client(settings)
    model = settings.import_model_bulk
    user_message = "Estimate densities for:\n" + "\n".join(f"- {name}" for name in cleaned)
    request: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.1,
        "max_tokens": 512,
    }
    extra_body = reasoning_extra_body(model)
    if extra_body:
        request["extra_body"] = extra_body

    try:
        response = client.chat.completions.create(**request)
    except APIStatusError as error:
        if error.status_code == 404:
            raise LLMError(
                f"Fireworks model not found: {model}. "
                "Check IMPORT_MODEL_BULK in your environment."
            ) from error
        raise LLMError(f"Fireworks request failed: {error.message}") from error

    content = ""
    if response.choices:
        message = response.choices[0].message
        content = (message.content or "").strip()
        if not content:
            content = strip_think_blocks(getattr(message, "reasoning_content", None) or "").strip()
    if not content:
        raise LLMError("Model returned empty density estimate")

    return parse_density_estimates(content, cleaned)


def parse_density_estimates(content: str, requested_names: list[str]) -> list[DensityEstimate]:
    payload = _parse_json_object(strip_think_blocks(content))
    raw_estimates = payload.get("estimates")
    if not isinstance(raw_estimates, list):
        raise LLMError("Density estimate response missing estimates list")

    by_name: dict[str, float | None] = {}
    for item in raw_estimates:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        by_name[name.casefold()] = _normalize_density(item.get("density_kg_m3"))

    return [
        DensityEstimate(name=name, density_kg_m3=by_name.get(name.casefold()))
        for name in requested_names
    ]


def _unique_names(names: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for name in names:
        trimmed = name.strip()
        if not trimmed:
            continue
        key = trimmed.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(trimmed)
    return cleaned


def _parse_json_object(content: str) -> dict[str, Any]:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        match = _JSON_OBJECT_RE.search(cleaned)
        if not match:
            raise LLMError("Density estimate response was not valid JSON") from None
        try:
            payload = json.loads(match.group(0))
        except json.JSONDecodeError as error:
            raise LLMError("Density estimate response was not valid JSON") from error
    if not isinstance(payload, dict):
        raise LLMError("Density estimate response was not a JSON object")
    return payload


def _normalize_density(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        density = float(value)
    except (TypeError, ValueError):
        return None
    if density <= 0 or density > 5000:
        return None
    return round(density / 10.0) * 10.0
