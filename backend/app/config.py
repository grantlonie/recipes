from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_base_url: str = "http://localhost:8000"
    cookie_secure: bool = False
    data_root: Path = Path("/data")
    frontend_dist: Path = Path("frontend/dist")
    recipe_editor_password: str = "recipes"
    recipe_editor_username: str = "editor"
    session_secret: str = Field(default="change-me", min_length=8)

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def recipe_root(self) -> Path:
        return self.data_root / "recipes"


@lru_cache
def get_settings() -> Settings:
    return Settings()
