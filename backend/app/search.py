from app.models import RecipeSummary, SearchResult


def search_recipes(recipes: list[RecipeSummary], query: str) -> list[SearchResult]:
    terms = [term.casefold() for term in query.split() if term.strip()]
    if not terms:
        return [SearchResult(match="all recipes", recipe=recipe, score=0) for recipe in recipes]

    results: list[SearchResult] = []
    for recipe in recipes:
        score, match = score_recipe(recipe, terms)
        if score > 0:
            results.append(SearchResult(match=match, recipe=recipe, score=score))

    return sorted(results, key=lambda result: (-result.score, result.recipe.title.casefold()))


def score_recipe(recipe: RecipeSummary, terms: list[str]) -> tuple[int, str]:
    title = recipe.title.casefold()
    tags = " ".join(recipe.tags).casefold()
    notes = " ".join(recipe.notes).casefold()
    source = (recipe.original_url or "").casefold()

    score = 0
    matches: list[str] = []
    for term in terms:
        if term in title:
            score += 100
            matches.append("title")
        elif term in tags:
            score += 60
            matches.append("tags")
        elif term in notes:
            score += 35
            matches.append("notes")
        elif term in source:
            score += 25
            matches.append("source")

    return score, ", ".join(sorted(set(matches))) if matches else ""


def search_details(recipes: list[RecipeSummary], details: dict[str, str], query: str) -> list[SearchResult]:
    terms = [term.casefold() for term in query.split() if term.strip()]
    if not terms:
        return [SearchResult(match="all recipes", recipe=recipe, score=0) for recipe in recipes]

    summary_results = {result.recipe.slug: result for result in search_recipes(recipes, query)}
    for recipe in recipes:
        text = details.get(recipe.slug, "").casefold()
        body_score = 0
        for term in terms:
            if term in text:
                body_score += 10
        if body_score == 0:
            continue
        if recipe.slug in summary_results:
            existing = summary_results[recipe.slug]
            summary_results[recipe.slug] = existing.model_copy(
                update={
                    "match": f"{existing.match}, recipe text",
                    "score": existing.score + body_score,
                }
            )
        else:
            summary_results[recipe.slug] = SearchResult(
                match="recipe text",
                recipe=recipe,
                score=body_score,
            )

    return sorted(summary_results.values(), key=lambda result: (-result.score, result.recipe.title.casefold()))
