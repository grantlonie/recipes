from unittest.mock import MagicMock, patch

import pytest

from app.config import Settings
from app.fireworks_llm import complete_cooklang


@pytest.fixture
def settings() -> Settings:
    return Settings(fireworks_api_key="test-key")


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
    assert request_kwargs["extra_body"] == {"reasoning_effort": "none"}

    assert "title: Test" in result
    assert "Step one." in result
