from __future__ import annotations

OUTPUT_LANGUAGE = "concise imperative English"
DEFAULT_MAX_SOURCE_CHARS = 6000

SYSTEM_PROMPT = """You convert recipes into Cooklang for a personal recipe app.

Output rules:
- Return ONLY a complete .cook document with YAML front matter between --- lines, then the recipe body.
- Use imperative step prose. Blank lines separate steps.
- Ingredients must appear inline in steps as @name{{quantity%unit}} or @name{{quantity%unit}}(note).
- Multi-word ingredient names MUST use braces: @olive oil{{30%ml}}, @all-purpose flour{{240%g}}.
- Put preparation words in (notes) after the amount, not in the ingredient name.
- Use ==Section Title== for sections (not markdown headings).
- Use #cookware{{}} markers when relevant and ~timer{{10%minutes}} for timers.
- Prefer decimal quantities in amounts, not fractions.
- Prefer grams (g) for mass and simple canonical ingredient names when possible.
- Use Tbsp with capital T for tablespoons.
- Do not invent ingredients or steps that are not supported by the source text.
- Omit tags from front matter.
- Front matter may include: title, source, image, servings, time, description.
- source and image must be flat strings: either an http(s) URL or omitted if unknown.

Language: {output_language}
Unit style: quantities use % between amount and unit (example: 240%g).
"""

FEW_SHOT_EXAMPLE = """---
title: Chili
source: https://example.com/chili
image: https://example.com/chili.jpg
servings: 6
---
Brown @beef{454%g} in #large pot{}.

Add @onion{1}(diced) and @garlic{3%cloves}(minced). Cook until softened.

Stir in @tomatoes{800%g}(crushed) and @kidney beans{400%g}. Simmer 30 minutes.
"""


def build_system_prompt() -> str:
    return "\n".join(
        [
            SYSTEM_PROMPT.format(output_language=OUTPUT_LANGUAGE).strip(),
            "",
            "Example:",
            FEW_SHOT_EXAMPLE,
        ]
    )


def truncate_source_text(text: str, max_chars: int = DEFAULT_MAX_SOURCE_CHARS) -> str:
    stripped = text.strip()
    if max_chars <= 0 or len(stripped) <= max_chars:
        return stripped
    return stripped[: max_chars - 1].rstrip() + "…"


def build_user_message(
    extracted_text: str,
    *,
    source_url: str | None = None,
    max_chars: int = DEFAULT_MAX_SOURCE_CHARS,
) -> str:
    parts = ["Convert this recipe source into Cooklang.", ""]
    if source_url:
        parts.extend([f"Original source URL: {source_url}", ""])
    parts.extend(["Source text:", truncate_source_text(extracted_text, max_chars=max_chars)])
    return "\n".join(parts)
