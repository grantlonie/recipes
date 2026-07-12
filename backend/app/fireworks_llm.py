from __future__ import annotations

import base64
import re
import uuid
from pathlib import Path
from typing import Any

from openai import APIStatusError, OpenAI

from app.config import Settings
from app.cooklang import sanitize_front_matter
from app.sources import guess_media_type

COOKLANG_FENCE_RE = re.compile(
    r"```(?:[A-Za-z0-9_+-]*)?\s*\n?(.*?)```",
    re.DOTALL | re.IGNORECASE,
)
THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


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
    # Unique per request so Fireworks can spread concurrent imports across replicas.
    # Shared sticky affinity was keeping bulk imports serialized on one replica.
    request: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.2,
        "max_tokens": settings.import_max_output_tokens,
        "user": f"recipes-import-{uuid.uuid4().hex}",
        "stream": True,
    }
    extra_body = reasoning_extra_body(model)
    if extra_body:
        request["extra_body"] = extra_body
    return request


def reasoning_extra_body(model: str) -> dict[str, Any] | None:
    """Disable thinking/reasoning for import latency without sending unsupported values."""
    model_id = model.casefold()
    # qwen3p7-plus and deepseek-v4 both accept Anthropic-style thinking=disabled.
    # /no_think and enable_thinking are ignored/rejected on Fireworks for these models.
    # gpt-oss rejects thinking=disabled (maps to invalid reasoning_effort=none).
    if "deepseek" in model_id or "qwen3" in model_id:
        return {"thinking": {"type": "disabled"}}
    return None


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

    content_parts: list[str] = []
    reasoning_parts: list[str] = []

    try:
        stream = client.chat.completions.create(**request_kwargs)
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            content_delta = delta.content or ""
            if content_delta:
                content_parts.append(content_delta)
            reasoning_delta = getattr(delta, "reasoning_content", None) or ""
            if reasoning_delta:
                reasoning_parts.append(reasoning_delta)
    except APIStatusError as error:
        if error.status_code == 404:
            raise LLMError(
                f"Fireworks model not found: {selected_model}. "
                "Check IMPORT_MODEL_TEXT / IMPORT_MODEL_VISION in your environment."
            ) from error
        raise LLMError(f"Fireworks request failed: {error.message}") from error

    content = "".join(content_parts).strip()
    if not content:
        # Hybrid reasoning models may stream only into reasoning_content when
        # thinking could not be disabled for the request.
        content = strip_think_blocks("".join(reasoning_parts)).strip()
    if not content:
        raise LLMError("Model returned empty content")

    return normalize_model_output(content)


def strip_think_blocks(content: str) -> str:
    return THINK_BLOCK_RE.sub("", content).strip()


def normalize_model_output(content: str) -> str:
    cleaned = strip_think_blocks(content)
    fenced = COOKLANG_FENCE_RE.search(cleaned)
    if fenced:
        cleaned = fenced.group(1).strip()
    elif not cleaned.startswith("---"):
        return cleaned
    return sanitize_front_matter(cleaned)
