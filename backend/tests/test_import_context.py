from app.import_context import build_system_prompt, build_user_message, truncate_source_text


def test_build_system_prompt_omits_ingredient_catalog():
    prompt = build_system_prompt()
    assert "Ingredient catalog" not in prompt
    assert "You convert recipes into Cooklang" in prompt
    assert "title: Chili" in prompt
    assert "prep time: 15 minutes" in prompt
    assert "cook time: 45 minutes" in prompt
    assert "Do not collapse prep and cook" in prompt
    assert "Preserve the source's measurement units" in prompt
    assert "Do not convert between volume and mass" in prompt
    assert "@kidney beans{2%cup}" in prompt
    assert "Prefer grams" not in prompt


def test_truncate_source_text_limits_length():
    text = "a" * 100
    assert len(truncate_source_text(text, max_chars=20)) == 20
    assert truncate_source_text(text, max_chars=20).endswith("…")


def test_build_user_message_truncates_source_text():
    message = build_user_message("x" * 100, source_url="https://example.com/r", max_chars=30)
    assert "Original source URL: https://example.com/r" in message
    assert "x" * 29 in message
