from __future__ import annotations

import base64
import re
from pathlib import Path
from typing import Any

from openai import APIStatusError, OpenAI

from app.config import Settings
from app.sources import guess_media_type

COOKLANG_FENCE_RE = re.compile(r"```(?:cooklang|cook)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


class LLMError(RuntimeError):
    pass


def create_client(settings: Settings) -> OpenAI:
    if not settings.fireworks_api_key.strip():
        raise LLMError("FIREWORKS_API_KEY is not configured")
    return OpenAI(api_key=settings.fireworks_api_key, base_url=settings.fireworks_base_url)


def import_request_kwargs(
    *,
    settings: Settings,
    system_prompt: str,
    user_content: str | list[dict[str, object]],
    model: str,
) -> dict[str, Any]:
    cache_key = settings.import_cache_affinity_key.strip() or "recipes-import"
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.2,
        "max_tokens": settings.import_max_output_tokens,
        "user": cache_key,
        "extra_headers": {"x-session-affinity": cache_key},
        "extra_body": {"reasoning_effort": "none"},
        "stream": True,
    }


def complete_cooklang(
    *,
    settings: Settings,
    system_prompt: str,
    user_message: str,
    model: str | None = None,
    image_path: Path | None = None,
) -> str:
    client = create_client(settings)
    selected_model = model or settings.import_model_text

    if image_path is not None:
        selected_model = settings.import_model_vision
        media_type = guess_media_type(image_path)
        encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
        user_content: str | list[dict[str, object]] = [
            {"type": "text", "text": user_message},
            {
                "type": "image_url",
                "image_url": {"url": f"data:{media_type};base64,{encoded}"},
            },
        ]
    else:
        user_content = user_message

    request_kwargs = import_request_kwargs(
        settings=settings,
        system_prompt=system_prompt,
        user_content=user_content,
        model=selected_model,
    )

    parts: list[str] = []

    try:
        stream = client.chat.completions.create(**request_kwargs)
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content or ""
            if delta:
                parts.append(delta)
    except APIStatusError as error:
        if error.status_code == 404:
            raise LLMError(
                f"Fireworks model not found: {selected_model}. "
                "Check IMPORT_MODEL_TEXT / IMPORT_MODEL_VISION in your environment."
            ) from error
        raise LLMError(f"Fireworks request failed: {error.message}") from error

    content = "".join(parts)
    if not content.strip():
        raise LLMError("Model returned empty content")

    return normalize_model_output(content)


def normalize_model_output(content: str) -> str:
    fenced = COOKLANG_FENCE_RE.search(content)
    if fenced:
        return fenced.group(1).strip()
    if content.strip().startswith("---"):
        return content.strip()
    return content.strip()
