"""Runtime configuration from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from zoneinfo import ZoneInfo


class ConfigError(RuntimeError):
    pass


def find_dotenv(path: str = ".env") -> Path | None:
    """The repo's `.env`: here, or one folder up (the CLI runs from `backend/`)."""
    return next((c for c in (Path(path), Path("..") / path) if c.is_file()), None)


def load_dotenv(path: str = ".env") -> None:
    """Minimal .env loader for running the CLI on the host. Never overrides real env vars."""
    if (candidate := find_dotenv(path)) is not None:
        for line in candidate.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def set_dotenv_values(path: Path, values: dict[str, str]) -> None:
    """Set KEY=value lines in a .env file: replaces existing ones, appends the rest, keeps every
    other line as is. The file ends up readable by its owner only, since it holds secrets."""
    lines = path.read_text().splitlines() if path.is_file() else []
    pending = dict(values)
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line else None
        if key in values and not line.lstrip().startswith("#"):
            if key in pending:
                out.append(f"{key}={pending.pop(key)}")
            continue  # a duplicate of a key already written
        out.append(line)
    out += [f"{k}={v}" for k, v in pending.items()]
    path.write_text("\n".join(out) + "\n")
    path.chmod(0o600)


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
    google_calendar_id: str
    anthropic_api_key: str
    llm_model: str
    llm_effort: str
    llm_paste_effort: str
    llm_body_chars: int
    timezone: str
    ghost_days: int
    followup_days: int
    # Base64 of the service account's JSON key (or the JSON). Never printed in a repr.
    google_service_account_key: str = field(default="", repr=False)

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
            google_calendar_id=e.get("GOOGLE_CALENDAR_ID", "primary").strip() or "primary",
            anthropic_api_key=e.get("ANTHROPIC_API_KEY", ""),
            llm_model=e.get("LLM_MODEL", "claude-haiku-5-5"),
            llm_effort=e.get("LLM_EFFORT", "low"),
            llm_paste_effort=e.get("LLM_PASTE_EFFORT", "medium"),
            llm_body_chars=int(e.get("LLM_BODY_CHARS", "4000")),
            timezone=e.get("TIMEZONE", "America/Buenos_Aires"),
            ghost_days=int(e.get("GHOST_DAYS", "14")),
            followup_days=int(e.get("FOLLOWUP_DAYS", "7")),
            google_service_account_key=e.get("GOOGLE_SERVICE_ACCOUNT_KEY", "").strip(),
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
        if self.google_service_account_key and self.google_calendar_id == "primary":
            # "primary" would be the service account's own (empty) calendar, not yours.
            raise ConfigError(
                "GOOGLE_SERVICE_ACCOUNT_KEY needs GOOGLE_CALENDAR_ID set to your calendar's ID "
                "(your Gmail address for the main calendar)"
            )

    @cached_property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def my_addresses(self) -> set[str]:
        return {a for a in (self.gmail_address, self.allowed_email) if a}
