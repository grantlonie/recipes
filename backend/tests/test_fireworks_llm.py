from unittest.mock import MagicMock, patch

import pytest

from app.config import Settings
from app.fireworks_llm import (
    complete_cooklang,
    import_request_kwargs,
    normalize_model_output,
    reasoning_extra_body,
)


@pytest.fixture
def settings() -> Settings:
    return Settings(fireworks_api_key="test-key")


def test_normalize_model_output_strips_trailing_reasoning():
    raw = """---
title: Scallops
---

Cook @scallops{1%lb}.

Wait, I need to reconsider the vermouth amount. The source says cup without a number.

Actually, let me finalize:

---
title: Scallops Again
---

Cook @scallops{2%lb}.
"""
    normalized = normalize_model_output(raw)
    assert normalized.startswith("---")
    assert "Cook @scallops{1%lb}." in normalized
    assert "Wait, I need to reconsider" not in normalized
    assert "Scallops Again" not in normalized
    assert normalized.count("---") == 2


def test_normalize_model_output_strips_leading_prose():
    raw = """Here is the recipe:

---
title: Soup
---

Cook @onion{1}.
"""
    normalized = normalize_model_output(raw)
    assert normalized.startswith("---")
    assert "Here is the recipe" not in normalized
    assert "Cook @onion{1}." in normalized


def test_normalize_model_output_strips_yaml_fence():
    raw = """```yaml
---
title: Award-Winning Soft Chocolate Chip Cookies
---

Mix @flour{}.
```"""
    normalized = normalize_model_output(raw)
    assert normalized.startswith("---")
    assert "```" not in normalized
    assert "title: Award-Winning Soft Chocolate Chip Cookies" in normalized
    assert "Mix @flour{}." in normalized


def test_normalize_model_output_strips_cooklang_fence():
    raw = """```cooklang
---
title: Chili
---

Brown @beef{454%g}.
```"""
    normalized = normalize_model_output(raw)
    assert normalized.startswith("---")
    assert "```" not in normalized
    assert "Brown @beef{454%g}." in normalized


def test_normalize_model_output_strips_result_wrapper():
    raw = """<result>
---
title: Sheet-Pan Chicken
---

Add @jalapeño brine{2%Tbsp}.
</result>"""
    normalized = normalize_model_output(raw)
    assert normalized.startswith("---")
    assert "<result>" not in normalized
    assert "</result>" not in normalized
    assert "Add @jalapeño brine{2%Tbsp}." in normalized


def test_normalize_model_output_strips_unclosed_result_prefix():
    raw = """<result>
---
title: Soup
---

Cook @onion{1}.
"""
    normalized = normalize_model_output(raw)
    assert normalized.startswith("---")
    assert "<result>" not in normalized
    assert "Cook @onion{1}." in normalized


def test_reasoning_extra_body_is_model_aware():
    assert reasoning_extra_body("accounts/fireworks/models/qwen3p7-plus") == {
        "thinking": {"type": "disabled"}
    }
    assert reasoning_extra_body("accounts/fireworks/models/deepseek-v4-flash") == {
        "thinking": {"type": "disabled"}
    }
    assert reasoning_extra_body("accounts/fireworks/models/gpt-oss-120b") is None


def test_import_request_kwargs_uses_unique_user_without_sticky_affinity(settings: Settings):
    first = import_request_kwargs(
        settings=settings,
        system_prompt="system",
        user_content="one",
        model=settings.import_model_text,
    )
    second = import_request_kwargs(
        settings=settings,
        system_prompt="system",
        user_content="two",
        model=settings.import_model_text,
    )
    assert first["user"] != second["user"]
    assert first["user"].startswith("recipes-import-")
    assert "extra_headers" not in first
    assert "extra_headers" not in second


def test_complete_cooklang_streams_chunks(settings: Settings):
    chunk_one = MagicMock()
    chunk_one.choices = [MagicMock(delta=MagicMock(content="---\ntitle: Test\n---\n\n"))]
    chunk_two = MagicMock()
    chunk_two.choices = [MagicMock(delta=MagicMock(content="Step one."))]

    fake_stream = MagicMock()
    fake_stream.__iter__ = MagicMock(return_value=iter([chunk_one, chunk_two]))

    with patch("app.fireworks_llm.create_client") as create_client:
        create_client.return_value.chat.completions.create.return_value = fake_stream
        result = complete_cooklang(
            settings=settings,
            system_prompt="system",
            user_message="user",
        )

    create_client.return_value.chat.completions.create.assert_called_once()
    request_kwargs = create_client.return_value.chat.completions.create.call_args.kwargs
    assert request_kwargs["extra_body"] == {"thinking": {"type": "disabled"}}
    assert request_kwargs["messages"][1]["content"] == "user"
    assert "extra_headers" not in request_kwargs
    assert str(request_kwargs["user"]).startswith("recipes-import-")

    assert "title: Test" in result
    assert "Step one." in result


def test_complete_cooklang_falls_back_to_reasoning_content(settings: Settings):
    chunk = MagicMock()
    chunk.choices = [
        MagicMock(
            delta=MagicMock(
                content=None,
                reasoning_content="---\ntitle: From Reasoning\n---\n\nMix @flour{}.",
            )
        )
    ]
    fake_stream = MagicMock()
    fake_stream.__iter__ = MagicMock(return_value=iter([chunk]))

    with patch("app.fireworks_llm.create_client") as create_client:
        create_client.return_value.chat.completions.create.return_value = fake_stream
        result = complete_cooklang(
            settings=settings,
            system_prompt="system",
            user_message="user",
        )

    assert "From Reasoning" in result
    assert "@flour" in result


def test_complete_cooklang_disables_thinking_for_deepseek(settings: Settings):
    fake_stream = MagicMock()
    fake_stream.__iter__ = MagicMock(
        return_value=iter(
            [MagicMock(choices=[MagicMock(delta=MagicMock(content="---\ntitle: X\n---\n\nOk."))])]
        )
    )

    with patch("app.fireworks_llm.create_client") as create_client:
        create_client.return_value.chat.completions.create.return_value = fake_stream
        complete_cooklang(
            settings=settings,
            system_prompt="system",
            user_message="user",
            model="accounts/fireworks/models/deepseek-v4-flash",
        )

    request_kwargs = create_client.return_value.chat.completions.create.call_args.kwargs
    assert request_kwargs["extra_body"] == {"thinking": {"type": "disabled"}}
    assert "reasoning_effort" not in request_kwargs["extra_body"]
