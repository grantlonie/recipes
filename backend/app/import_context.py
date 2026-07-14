from __future__ import annotations

from app.import_validate import clean_source_text

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
  Never put counts on cookware (#pan{{}}, not pan{{1}} or baking pan{{1}}).
- Prefer decimal quantities in amounts, not fractions.
- Preserve the source's measurement units (cups, Tbsp, tsp, ml, L, g, oz, lb, counts).
  Do not convert between volume and mass (no cups/Tbsp/tsp/ml to grams or vice versa).
  A later step converts volumes to grams using catalog densities.
- Tablespoon vs teaspoon is size, not casing: 1 tablespoon ≠ 1 teaspoon.
  Treat source spellings tbsp / tbs / tablespoon(s) (any case) as tablespoon → emit Tbsp.
  Treat source spellings tsp / teaspoon(s) (any case) as teaspoon → emit tsp.
  Never shrink a tablespoon amount down to a teaspoon (or vice versa), even when
  the source writes lowercase "tbsp" (example: "1 tbsp fennel seeds" → @fennel seeds{{1%Tbsp}}).
- When the source gives BOTH volume and weight, prefer the weight (use g/oz/lb).
- When the source says "X plus Y" (example: 3/4 cup plus 2 tablespoons), include the FULL amount.
- Ingredients marked "divided" or "separated" must use separate @ markers with the correct
  split amounts (example: 1 1/2 cups sugar separated → @granulated sugar{{1%cup}} in the
  batter and @granulated sugar{{0.5%cup}} in the syrup).
- Prefer simple canonical ingredient names when possible, but NEVER substitute a different substance:
  green bell pepper ≠ black pepper, vanilla bean ≠ vanilla extract,
  sweetened condensed milk ≠ milk, apricot jam ≠ apricots,
  instant vanilla pudding mix ≠ vanilla extract,
  confectioners' / powdered / icing sugar ≠ granulated sugar (use @powdered sugar{{}}).
- Prefer specific ingredient names from the source when they exist in common catalogs:
  orzo → @orzo{{}}, green onion/scallion → @scallions{{}}, mozzarella → @mozzarella{{}}.
- Every ingredient from the source Ingredients list MUST appear with an @ marker,
  including aromatics like garlic and scallions/green onions when listed.
  Do not leave measured amounts as plain text (wrong: 1 Tbsp sambal oelek;
  right: @sambal oelek{{1%Tbsp}}).
- Do not tag cooking byproducts as ingredients. Pan gravy, drippings, pasta water,
  reserved cooking liquid, and leftover fat are process notes, not shopping items —
  leave measured amounts as plain text (e.g. "ladle 1/4–1/2 cup of gravy",
  "reserve 1/2 cup pasta water", "drain all but 2 tablespoons of the fat").
- Author tips, variants, omit-if advice, and "UPDATED NOTES" go on Cooklang note lines
  starting with `>` (not as numbered/cook steps). Keep each note concise (1-2 sentences).
  Place each `>` note next to the steps it relates to (inline with the body).
  Do not copy thank-yous, review replies, or filler commentary.
  Example: `> Soft crust: mix melted butter into the batter instead of pouring it over.`
- Use front-matter `description` for introductory blurb/notes that should appear before
  the steps (recipe summary). Do not put those in a leading `>` note; use `description`.
  Detailed or step-local tips stay as `>` body notes.
- Substitution tips and "only if you change X" add-ons are `>` notes with plain text
  (no @ markers) when they are not on the source Ingredients list
  (e.g. `> If not using beer, add a packet of active dry yeast.`).
  Do tag optional ingredients that ARE listed (e.g. "1/2 cup pecans, optional" →
  @pecans{{}}(optional)).
- For "to taste", "as needed", "a pinch", or "a splash": use @name{{}}(to taste) or
  @name{{}}(as needed) with an EMPTY amount. Never write {{0%g}}, {{0}}, {{pinch}},
  {{splash}}, {{to taste}}, or {{as needed}}.
- Compound tools/equipment stay plain text or #cookware: "4 (12-inch) skewers",
  not "4 pieces skewer" or "4 skewer".
- Preserve make-ahead timing from the source as steps when it is part of the cook flow
  (overnight chill, rest times, hold overnight before baking); phrasing tips stay as `>` notes.
- Always write tablespoon amounts as Tbsp (capital T). Source casing does not matter.
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
description: Hearty weeknight chili with kidney beans.
---
Brown @beef{1%lb} in #large pot{}.

Add @onion{1}(diced) and @garlic{3%cloves}(minced). Cook until softened.

Stir in @tomatoes{28%oz}(crushed) and @kidney beans{2%cup}. Simmer ~{30%minutes}.

> Leftovers keep 3 days refrigerated.
"""

NEGATIVE_EXAMPLE = """Wrong (do not do this):
Add @black pepper{1}(green bell, diced) and @vanilla extract{1}(bean).
Season with @salt{0%g}(to taste). Oil the baking pan{1}.
Add @fennel seeds{1%tsp} when the source says 1 tbsp fennel seeds.
Use @granulated sugar{}(confectioners') for powdered sugar.
If using juice instead of beer, add @instant yeast{}(dry active).
If you prefer a softer crust, mix the butter into the batter.

Right:
Add @green bell pepper{1}(diced) and @vanilla bean{1}(split).
Season with @salt{}(to taste). Oil the #baking pan{}.
Add @fennel seeds{1%Tbsp} when the source says 1 tbsp fennel seeds.
Dust with @powdered sugar{}(as needed).
> If using juice instead of beer, add a packet of active dry yeast.
> Soft crust: mix melted butter into the batter instead of pouring it over the top.
Stir in @pecans{0.5%cup}(optional) when pecans are on the Ingredients list.
"""


def build_system_prompt() -> str:
    return "\n".join(
        [
            SYSTEM_PROMPT.format(output_language=OUTPUT_LANGUAGE).strip(),
            "",
            "Example:",
            FEW_SHOT_EXAMPLE,
            "",
            "Avoid these mistakes:",
            NEGATIVE_EXAMPLE,
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
    cleaned = clean_source_text(extracted_text)
    parts = ["Convert this recipe source into Cooklang.", ""]
    if source_url:
        parts.extend([f"Original source URL: {source_url}", ""])
    parts.extend(["Source text:", truncate_source_text(cleaned, max_chars=max_chars)])
    return "\n".join(parts)


def build_quality_repair_message(
    *,
    source_text: str,
    previous_cooklang: str,
    warnings: list[str],
    max_chars: int = DEFAULT_MAX_SOURCE_CHARS,
) -> str:
    warning_lines = "\n".join(f"- {warning}" for warning in warnings)
    return "\n".join(
        [
            "Repair this Cooklang recipe. Keep the same structure and meaning,",
            "but fix ONLY the listed problems. Return ONLY the corrected .cook document.",
            "",
            "Problems to fix:",
            warning_lines,
            "",
            "Original source text:",
            truncate_source_text(clean_source_text(source_text), max_chars=max_chars),
            "",
            "Previous Cooklang output:",
            previous_cooklang.strip(),
        ]
    )
