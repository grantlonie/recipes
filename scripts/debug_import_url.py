#!/usr/bin/env python3
"""Capture import pipeline artifacts for debugging LLM imports."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import Settings, get_settings  # noqa: E402
from app.extract import extract_html_text, extract_page_image_url  # noqa: E402
from app.fireworks_llm import (  # noqa: E402
    LLMError,
    create_client,
    import_request_kwargs,
    normalize_model_output,
)
from app.import_context import build_system_prompt, build_user_message  # noqa: E402
from app.importer import BROWSER_HEADERS, _finalize_import, _is_valid_import  # noqa: E402
from app.ingredients import IngredientRepository  # noqa: E402
from openai import APIStatusError  # noqa: E402


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def complete_cooklang_with_logs(
    *,
    settings: Settings,
    system_prompt: str,
    user_message: str,
    model: str | None,
    stream_log_path: Path,
    label: str,
) -> tuple[str, dict[str, str | None], str]:
    client = create_client(settings)
    selected_model = model or settings.import_model_text

    request_kwargs = import_request_kwargs(
        settings=settings,
        system_prompt=system_prompt,
        user_content=user_message,
        model=selected_model,
    )

    started_at = time.perf_counter()
    parts: list[str] = []
    reasoning_parts: list[str] = []
    first_token_at: float | None = None
    first_reasoning_at: float | None = None
    finish_reason: str | None = None
    stream_lines: list[str] = [
        f"# {label}",
        f"model={selected_model}",
        f"user={request_kwargs.get('user')}",
        f"extra_body={request_kwargs.get('extra_body')}",
        f"started_at={datetime.now(UTC).isoformat()}",
        "",
    ]

    try:
        stream = client.chat.completions.create(**request_kwargs)
        for chunk in stream:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            if choice.finish_reason:
                finish_reason = choice.finish_reason

            reasoning_delta = getattr(choice.delta, "reasoning_content", None) or ""
            if reasoning_delta:
                now = time.perf_counter()
                if first_reasoning_at is None:
                    first_reasoning_at = now
                    stream_lines.append(f"FIRST_REASONING at +{now - started_at:.3f}s")
                stream_lines.append(f"+{now - started_at:.3f}s reasoning: {reasoning_delta!r}")
                reasoning_parts.append(reasoning_delta)

            delta = choice.delta.content or ""
            if not delta:
                continue
            now = time.perf_counter()
            if first_token_at is None:
                first_token_at = now
                stream_lines.append(f"FIRST_TOKEN at +{now - started_at:.3f}s")
            stream_lines.append(f"+{now - started_at:.3f}s chunk: {delta!r}")
            parts.append(delta)
    except APIStatusError as error:
        raise LLMError(f"Fireworks request failed: {error.message}") from error

    finished_at = time.perf_counter()
    stream_lines.extend(
        [
            "",
            f"finished_at={datetime.now(UTC).isoformat()}",
            f"total_seconds={finished_at - started_at:.3f}",
            f"first_token_seconds={(first_token_at - started_at) if first_token_at else None}",
            f"first_reasoning_seconds={(first_reasoning_at - started_at) if first_reasoning_at else None}",
            f"finish_reason={finish_reason}",
            f"output_chars={sum(len(part) for part in parts)}",
            f"reasoning_chars={sum(len(part) for part in reasoning_parts)}",
        ]
    )

    response = getattr(stream, "response", None)
    headers: dict[str, str | None] = {}
    if response is not None and getattr(response, "headers", None) is not None:
        for key in (
            "fireworks-prompt-tokens",
            "fireworks-cached-prompt-tokens",
            "fireworks-generated-tokens",
        ):
            headers[key] = response.headers.get(key)
            stream_lines.append(f"header {key}={headers[key]}")

    write_text(stream_log_path, "\n".join(stream_lines) + "\n")
    return "".join(parts), headers, "".join(reasoning_parts)


def resolve_ingredients(settings: Settings) -> IngredientRepository:
    candidates = [
        settings.ingredients_path,
        ROOT / "data" / "ingredients.json",
    ]
    for catalog_path in candidates:
        try:
            catalog_path.parent.mkdir(parents=True, exist_ok=True)
            return IngredientRepository(catalog_path=catalog_path)
        except OSError:
            continue
    raise RuntimeError("Could not find a writable ingredients catalog path")


def debug_import_url(url: str, output_dir: Path) -> None:
    settings = get_settings()
    ingredients = resolve_ingredients(settings)
    output_dir.mkdir(parents=True, exist_ok=True)

    timeout = httpx.Timeout(90.0, connect=15.0)
    with httpx.Client(follow_redirects=True, timeout=timeout, headers=BROWSER_HEADERS) as client:
        response = client.get(url)
        response.raise_for_status()
        html = response.text
        final_url = str(response.url)

    extracted = extract_html_text(html)
    image_url = extract_page_image_url(html, final_url)
    system_prompt = build_system_prompt()
    user_message = build_user_message(
        extracted,
        source_url=url,
        max_chars=settings.import_max_source_chars,
    )

    write_text(
        output_dir / "00_meta.txt",
        "\n".join(
            [
                f"url={url}",
                f"final_url={final_url}",
                f"html_chars={len(html)}",
                f"extracted_chars={len(extracted)}",
                f"extracted_truncated_chars={len(user_message)}",
                f"image_url={image_url or ''}",
                f"import_model_text={settings.import_model_text}",
                f"import_model_repair={settings.import_model_repair}",
                f"import_max_source_chars={settings.import_max_source_chars}",
                f"import_max_output_tokens={settings.import_max_output_tokens}",
            ]
        )
        + "\n",
    )
    write_text(output_dir / "01_extracted_text.txt", extracted)
    write_text(output_dir / "02_system_prompt.txt", system_prompt)
    write_text(output_dir / "03_user_message.txt", user_message)
    write_text(
        output_dir / "04_llm_request.json",
        json.dumps(
            {
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "model": settings.import_model_text,
                "max_tokens": settings.import_max_output_tokens,
                "temperature": 0.2,
            },
            indent=2,
        )
        + "\n",
    )

    raw, primary_headers, primary_reasoning = complete_cooklang_with_logs(
        settings=settings,
        system_prompt=system_prompt,
        user_message=user_message,
        model=None,
        stream_log_path=output_dir / "05_llm_stream_primary.log",
        label="primary",
    )
    write_text(output_dir / "06_llm_response_raw.txt", raw)
    write_text(output_dir / "06b_llm_reasoning_primary.txt", primary_reasoning or "(none)")

    normalized = normalize_model_output(raw)
    write_text(output_dir / "07_llm_response_normalized.txt", normalized)

    repair_headers: dict[str, str | None] = {}
    if not _is_valid_import(normalized):
        repair_message = (
            f"{user_message}\n\n"
            "The previous output was invalid Cooklang. "
            "Return only valid Cooklang with YAML front matter."
        )
        write_text(output_dir / "08_repair_user_message.txt", repair_message)
        raw, repair_headers, repair_reasoning = complete_cooklang_with_logs(
            settings=settings,
            system_prompt=system_prompt,
            user_message=repair_message,
            model=settings.import_model_repair,
            stream_log_path=output_dir / "09_llm_stream_repair.log",
            label="repair",
        )
        write_text(output_dir / "10_llm_response_repair_raw.txt", raw)
        write_text(output_dir / "10b_llm_reasoning_repair.txt", repair_reasoning or "(none)")
        normalized = normalize_model_output(raw)
        write_text(output_dir / "11_llm_response_repair_normalized.txt", normalized)

    preview = _finalize_import(
        normalized,
        source_url=url,
        image_url=image_url,
        settings=settings,
        ingredients=ingredients,
    )
    write_text(output_dir / "12_final_preview.cook", preview.content)
    write_text(
        output_dir / "13_final_preview_meta.txt",
        "\n".join(
            [
                f"suggested_slug={preview.suggested_slug}",
                f"unmatched_ingredients={preview.unmatched_ingredients}",
                f"primary_cache_headers={primary_headers}",
                f"repair_cache_headers={repair_headers}",
            ]
        )
        + "\n",
    )

    print(f"Wrote import debug logs to {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Debug-import a recipe URL and write pipeline logs.")
    parser.add_argument("url", help="Recipe URL to import")
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Directory for log files (default: logs/import-debug/<slug>)",
    )
    args = parser.parse_args()

    slug = args.url.rstrip("/").split("/")[-1] or "import"
    output_dir = args.output_dir or ROOT / "logs" / "import-debug" / slug
    debug_import_url(args.url, output_dir)


if __name__ == "__main__":
    main()
