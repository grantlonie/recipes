from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_base_url: str = "http://localhost:8000"
    cookie_secure: bool = False
    data_root: Path = Path("/data")
    fireworks_api_key: str = ""
    fireworks_base_url: str = "https://api.fireworks.ai/inference/v1"
    frontend_dist: Path = Path("frontend/dist")
    import_max_output_tokens: int = 4096
    import_max_source_chars: int = 6000
    import_model_bulk: str = "accounts/fireworks/models/deepseek-v4-flash"
    import_model_repair: str = "accounts/fireworks/models/gpt-oss-120b"
    import_model_text: str = "accounts/fireworks/models/qwen3p7-plus"
    import_model_vision: str = "accounts/fireworks/models/qwen3p7-plus"
    jina_api_key: str = ""
    page_fetch_concurrency: int = 1
    page_fetch_fallback_enabled: bool = True
    page_fetch_max_retries: int = 2
    page_fetch_min_interval_seconds: float = 0.75
    recipe_editor_password: str = "recipes"
    recipe_editor_username: str = "editor"
    session_secret: str = Field(default="change-me", min_length=8)

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def recipe_root(self) -> Path:
        return self.data_root / "recipes"

    @property
    def ingredients_path(self) -> Path:
        return self.data_root / "ingredients.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
