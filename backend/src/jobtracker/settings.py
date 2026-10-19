"""Runtime configuration from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import cached_property
from zoneinfo import ZoneInfo


class ConfigError(RuntimeError):
    pass


def load_dotenv(path: str = ".env") -> None:
    """Minimal .env loader for running the CLI on the host. Never overrides real env vars."""
    from pathlib import Path

    for candidate in (Path(path), Path("..") / path):
        if not candidate.is_file():
            continue
        for line in candidate.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
        return


def _bool(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_env: str
    database_url: str
    allowed_email: str
    auth_dev_bypass: bool
    cf_access_team_domain: str
    cf_access_aud: str
    gmail_address: str
    gmail_app_password: str
    imap_host: str
    imap_extra_query: str
    anthropic_api_key: str
    llm_model: str
    llm_effort: str
    llm_body_chars: int
    timezone: str
    ghost_days: int
    followup_days: int

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        e = os.environ if env is None else env
        s = cls(
            app_env=e.get("APP_ENV", "local"),
            database_url=e.get(
                "DATABASE_URL", "postgresql://jobtracker:jobtracker@localhost:5433/jobtracker"
            ),
            allowed_email=e.get("ALLOWED_EMAIL", "").strip().lower(),
            auth_dev_bypass=_bool(e.get("AUTH_DEV_BYPASS")),
            cf_access_team_domain=e.get("CF_ACCESS_TEAM_DOMAIN", "").strip(),
            cf_access_aud=e.get("CF_ACCESS_AUD", "").strip(),
            gmail_address=e.get("GMAIL_ADDRESS", "").strip().lower(),
            gmail_app_password=e.get("GMAIL_APP_PASSWORD", "").replace(" ", ""),
            imap_host=e.get("IMAP_HOST", "imap.gmail.com"),
            imap_extra_query=e.get("IMAP_QUERY", "-category:promotions -category:social -in:chats"),
            anthropic_api_key=e.get("ANTHROPIC_API_KEY", ""),
            llm_model=e.get("LLM_MODEL", "claude-haiku-5-5"),
            llm_effort=e.get("LLM_EFFORT", "low"),
            llm_body_chars=int(e.get("LLM_BODY_CHARS", "4000")),
            timezone=e.get("TIMEZONE", "America/Buenos_Aires"),
            ghost_days=int(e.get("GHOST_DAYS", "14")),
            followup_days=int(e.get("FOLLOWUP_DAYS", "7")),
        )
        s.validate(in_lambda=bool(e.get("AWS_LAMBDA_FUNCTION_NAME")))
        return s

    def validate(self, *, in_lambda: bool) -> None:
        if self.auth_dev_bypass and (self.app_env != "local" or in_lambda):
            # Belt and braces: the bypass can only ever exist on a laptop.
            raise ConfigError("AUTH_DEV_BYPASS is only allowed with APP_ENV=local outside Lambda")
        if self.app_env not in {"local", "prod"}:
            raise ConfigError(f"APP_ENV must be local or prod, got {self.app_env!r}")
        if self.ghost_days <= self.followup_days:
            raise ConfigError("GHOST_DAYS must be greater than FOLLOWUP_DAYS")

    @cached_property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def my_addresses(self) -> set[str]:
        return {a for a in (self.gmail_address, self.allowed_email) if a}
