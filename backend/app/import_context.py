from __future__ import annotations

OUTPUT_LANGUAGE = "concise imperative English"
DEFAULT_MAX_SOURCE_CHARS = 6000

SYSTEM_PROMPT = """You convert recipes into Cooklang for a personal recipe app.

Output rules:
- Return ONLY a complete .cook document with YAML front matter between --- lines,
  then the recipe body.
- Do not wrap the document in markdown fences (no ```yaml or ```cooklang).
- Use imperative step prose. Blank lines separate steps.
- Ingredients must appear inline in steps as @name{{quantity%unit}} or @name{{quantity%unit}}(note).
- Multi-word ingredient names MUST use braces: @olive oil{{2%Tbsp}}, @all-purpose flour{{1.5%cup}}.
- Put preparation words in (notes) after the amount, not in the ingredient name.
- Use ==Section Title== for sections (not markdown headings).
- Use #cookware{{}} markers when relevant and ~timer{{10%minutes}} for timers.
- Prefer decimal quantities in amounts, not fractions.
- Preserve the source's measurement units (cups, Tbsp, tsp, ml, L, g, oz, lb, counts).
  Do not convert between volume and mass (no cups/Tbsp/tsp/ml to grams or vice versa).
  A later step converts volumes to grams using catalog densities.
- Prefer simple canonical ingredient names when possible.
- Use Tbsp with capital T for tablespoons.
- Do not invent ingredients or steps that are not supported by the source text.
- Omit tags from front matter.
- Front matter may include: title, source, image, servings, prep time, cook time,
  time, description.
- When the source lists prep and cook times separately, store BOTH as separate keys:
  prep time: 20 minutes
  cook time: 1 hour 30 minutes
  Do not collapse prep and cook into a single `time` total unless the source only
  gives one overall duration.
- Use `time` only for a single overall duration when prep/cook are not listed separately.
- Prefer plain English durations (20 minutes, 1 hour 30 minutes).
- YAML-quote the entire title when it contains quotes or punctuation
  (example: title: '"Greek" Lamb with Orzo'), never title: "Greek" Lamb....
- source and image must be flat strings: either an http(s) URL or omitted if unknown.

Language: {output_language}
Unit style: quantities use % between amount and unit (example: 1.5%cup).
"""

FEW_SHOT_EXAMPLE = """---
title: Chili
source: https://example.com/chili
image: https://example.com/chili.jpg
servings: 6
prep time: 15 minutes
cook time: 45 minutes
---
Brown @beef{1%lb} in #large pot{}.

Add @onion{1}(diced) and @garlic{3%cloves}(minced). Cook until softened.

Stir in @tomatoes{28%oz}(crushed) and @kidney beans{2%cup}. Simmer ~{30%minutes}.
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
