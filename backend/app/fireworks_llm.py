from __future__ import annotations

import base64
import logging
import re
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from openai import APIStatusError, OpenAI

from app.config import DEFAULT_FIREWORKS_MODEL, Settings
from app.cooklang import sanitize_front_matter, trim_cooklang_document
from app.sources import guess_media_type

logger = logging.getLogger(__name__)

# Serverless IDs Fireworks has removed. Production .env may still pin these.
RETIRED_FIREWORKS_MODELS = {
    "accounts/fireworks/models/qwen3p7-plus": DEFAULT_FIREWORKS_MODEL,
    "accounts/fireworks/models/deepseek-v4-flash": DEFAULT_FIREWORKS_MODEL,
}

_unavailable_models: set[str] = set()
_T = TypeVar("_T")

COOKLANG_FENCE_RE = re.compile(
    r"```(?:[A-Za-z0-9_+-]*)?\s*\n?(.*?)```",
    re.DOTALL | re.IGNORECASE,
)
RESULT_BLOCK_RE = re.compile(
    r"<result>\s*(.*?)\s*</result>",
    re.DOTALL | re.IGNORECASE,
)
THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


class LLMError(RuntimeError):
    pass


def create_client(settings: Settings) -> OpenAI:
    if not settings.fireworks_api_key.strip():
        raise LLMError("FIREWORKS_API_KEY is not configured")
    return OpenAI(api_key=settings.fireworks_api_key, base_url=settings.fireworks_base_url)


def reset_unavailable_fireworks_models() -> None:
    _unavailable_models.clear()


def mark_fireworks_model_unavailable(model: str) -> None:
    _unavailable_models.add(model)


def resolve_fireworks_model(model: str) -> str:
    """Map retired or previously-404 serverless IDs to a current default."""
    if model in _unavailable_models:
        return DEFAULT_FIREWORKS_MODEL
    return RETIRED_FIREWORKS_MODELS.get(model, model)


def fireworks_model_attempts(model: str) -> tuple[str, ...]:
    resolved = resolve_fireworks_model(model)
    if resolved == DEFAULT_FIREWORKS_MODEL:
        return (resolved,)
    return (resolved, DEFAULT_FIREWORKS_MODEL)


def request_with_model_fallback(
    *,
    model: str,
    not_found_hint: str,
    send: Callable[[str], _T],
) -> _T:
    last_404: APIStatusError | None = None
    attempted = model
    attempts = fireworks_model_attempts(model)
    for index, attempted in enumerate(attempts):
        try:
            return send(attempted)
        except APIStatusError as error:
            if error.status_code == 404:
                mark_fireworks_model_unavailable(attempted)
                if index < len(attempts) - 1:
                    logger.warning(
                        "Fireworks model not found: %s; retrying with %s",
                        attempted,
                        attempts[index + 1],
                    )
                    last_404 = error
                    continue
                last_404 = error
                break
            raise LLMError(f"Fireworks request failed: {error.message}") from error
    raise LLMError(f"Fireworks model not found: {attempted}. {not_found_hint}") from last_404


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
    # deepseek-v4 and qwen3 both accept Anthropic-style thinking=disabled.
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

    def send(attempt_model: str) -> str:
        request_kwargs = import_request_kwargs(
            settings=settings,
            system_prompt=system_prompt,
            user_content=user_content,
            model=attempt_model,
        )
        return _read_completion_stream(client, request_kwargs)

    content = request_with_model_fallback(
        model=selected_model,
        not_found_hint="Check IMPORT_MODEL_TEXT / IMPORT_MODEL_VISION in your environment.",
        send=send,
    )
    return normalize_model_output(content)


def _read_completion_stream(client: OpenAI, request_kwargs: dict[str, Any]) -> str:
    content_parts: list[str] = []
    reasoning_parts: list[str] = []
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

    content = "".join(content_parts).strip()
    if not content:
        # Hybrid reasoning models may stream only into reasoning_content when
        # thinking could not be disabled for the request.
        content = strip_think_blocks("".join(reasoning_parts)).strip()
    if not content:
        raise LLMError("Model returned empty content")
    return content


def strip_think_blocks(content: str) -> str:
    return THINK_BLOCK_RE.sub("", content).strip()


def strip_result_wrappers(content: str) -> str:
    """Remove model wrappers like <result>...</result> around Cooklang docs."""
    cleaned = content.strip()
    match = RESULT_BLOCK_RE.search(cleaned)
    if match:
        return match.group(1).strip()
    if cleaned[:8].casefold() == "<result>":
        cleaned = cleaned[8:].lstrip()
    if cleaned[-9:].casefold() == "</result>":
        cleaned = cleaned[:-9].rstrip()
    return cleaned


def normalize_model_output(content: str) -> str:
    cleaned = strip_result_wrappers(strip_think_blocks(content))
    fenced = COOKLANG_FENCE_RE.search(cleaned)
    if fenced:
        cleaned = fenced.group(1).strip()
    cleaned = extract_cooklang_document(cleaned)
    if not cleaned.startswith("---"):
        return cleaned
    return sanitize_front_matter(trim_cooklang_document(cleaned))


def extract_cooklang_document(content: str) -> str:
    """Drop leading prose so the document starts at the first YAML front matter."""
    cleaned = content.strip()
    if cleaned.startswith("---"):
        return cleaned
    match = re.search(r"(?m)^---\s*$", cleaned)
    if not match:
        return cleaned
    return cleaned[match.start() :].strip()
