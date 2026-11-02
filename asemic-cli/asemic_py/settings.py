"""Global user settings: `~/.config/asemic/settings.toml`, then `./.asemic.toml` (project wins).

    [nav]
    wasd = false          # start in WASD nav mode (Esc on the row line toggles WASD <-> vim)

    [keymap]              # Textual binding id -> keys (comma-separated), e.g.
    "nav.up" = "up,i"

    [wasd]                # extra keys layered onto nav.* while WASD mode is on
    "nav.up" = "w"
"""

from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict, TomlConfigSettingsSource

SETTINGS_FILES = (Path.home() / ".config" / "asemic" / "settings.toml", Path.cwd() / ".asemic.toml")


class Nav(BaseModel):
    wasd: bool = False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(toml_file=SETTINGS_FILES, env_prefix="ASEMIC_", env_nested_delimiter="__")

    nav: Nav = Nav()
    keymap: dict[str, str] = {}
    wasd: dict[str, str] = {"nav.up": "w", "nav.left": "a", "nav.down": "s", "nav.right": "d"}

    @classmethod
    def settings_customise_sources(cls, settings_cls: type[BaseSettings], init_settings: PydanticBaseSettingsSource,
                                   env_settings: PydanticBaseSettingsSource, *_: PydanticBaseSettingsSource
                                   ) -> tuple[PydanticBaseSettingsSource, ...]:
        return init_settings, env_settings, TomlConfigSettingsSource(settings_cls)

    def nav_keymap(self, wasd: bool, defaults: dict[str, str]) -> dict[str, str]:
        """Full keymap for a nav mode: user `[keymap]` over `defaults`, + `[wasd]` keys appended."""
        km = {**defaults, **self.keymap}
        if wasd:
            for bid, keys in self.wasd.items():
                km[bid] = f"{km[bid]},{keys}" if bid in km else keys
        return km


def load_settings() -> Settings:
    try:
        return Settings()
    except Exception:  # malformed toml: defaults, !crash startup
        return Settings.model_construct()
