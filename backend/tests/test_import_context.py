from app.import_context import build_system_prompt, build_user_message, truncate_source_text


def test_build_system_prompt_omits_ingredient_catalog():
    prompt = build_system_prompt()
    assert "Ingredient catalog" not in prompt
    assert "You convert recipes into Cooklang" in prompt
    assert "title: Chili" in prompt


def test_truncate_source_text_limits_length():
    text = "a" * 100
    assert len(truncate_source_text(text, max_chars=20)) == 20
    assert truncate_source_text(text, max_chars=20).endswith("…")


def test_build_user_message_truncates_source_text():
    message = build_user_message("x" * 100, source_url="https://example.com/r", max_chars=30)
    assert "Original source URL: https://example.com/r" in message
    assert "x" * 29 in message
