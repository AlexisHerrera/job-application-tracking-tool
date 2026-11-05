"""Secrets in SSM Parameter Store (SecureString, AWS managed key `aws/ssm`).

The Lambdas get only the parameter prefix and the names they need (`SSM_PARAMETER_PREFIX`,
`SSM_SECRETS`) as environment variables; the values are read once at cold start, decrypted, and
put into this process's environment for `Settings.from_env`. They never appear in the Lambda
configuration or in Terraform state: Terraform doesn't manage these parameters, `jobtracker aws
push-secrets` writes them from your local `.env`.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterable, MutableMapping

log = logging.getLogger(__name__)

SECRET_NAMES = ("GMAIL_APP_PASSWORD", "ANTHROPIC_API_KEY", "GOOGLE_SERVICE_ACCOUNT_KEY")
DEFAULT_PREFIX = "/jobtracker/prod/"


def _names(raw: str) -> list[str]:
    return [n.strip() for n in raw.split(",") if n.strip()]


def fetch(client, prefix: str, names: Iterable[str]) -> tuple[dict[str, str], list[str]]:
    """(values by name, names that don't exist). GetParameters takes at most 10 names."""
    names = list(names)
    values: dict[str, str] = {}
    missing: list[str] = []
    for i in range(0, len(names), 10):
        chunk = names[i : i + 10]
        resp = client.get_parameters(Names=[prefix + n for n in chunk], WithDecryption=True)
        for p in resp.get("Parameters", []):
            values[p["Name"].removeprefix(prefix)] = p["Value"]
        missing += [n.removeprefix(prefix) for n in resp.get("InvalidParameters", [])]
    return values, missing


def load_into_env(env: MutableMapping[str, str] | None = None, client=None) -> list[str]:
    """Cold start: copy the configured secrets into the environment (a value already set wins,
    which only happens in tests). Returns the names that are missing in SSM; the caller decides
    whether that's fatal."""
    env = os.environ if env is None else env
    prefix = env.get("SSM_PARAMETER_PREFIX", "")
    names = _names(env.get("SSM_SECRETS", ""))
    if not prefix or not names:
        return []
    if client is None:
        import boto3

        client = boto3.client("ssm")
    values, missing = fetch(client, prefix, names)
    for name, value in values.items():
        env.setdefault(name, value)
    if missing:
        log.warning("SSM parameters not set yet: %s", ", ".join(prefix + n for n in missing))
    return missing


def push(client, prefix: str, values: dict[str, str]) -> list[str]:
    """Create or overwrite SecureStrings with the AWS managed key. Returns the names written."""
    written = []
    for name, value in values.items():
        client.put_parameter(
            Name=prefix + name,
            Value=value,
            Type="SecureString",
            KeyId="alias/aws/ssm",
            Overwrite=True,
            Tier="Standard",
        )
        written.append(prefix + name)
    return written
