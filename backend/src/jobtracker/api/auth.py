"""Cloudflare Access JWT validation. This is what closes the cloudfront.net / Function URL bypass."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request

from jobtracker.settings import Settings

log = logging.getLogger(__name__)

HEADER = "Cf-Access-Jwt-Assertion"


@dataclass(frozen=True)
class User:
    email: str


class AccessVerifier:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.bypass = settings.auth_dev_bypass
        if not self.bypass:
            team = settings.cf_access_team_domain
            if not (team and settings.cf_access_aud and settings.allowed_email):
                raise RuntimeError(
                    "CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD and ALLOWED_EMAIL are required "
                    "unless AUTH_DEV_BYPASS=true (local only)"
                )
            self.issuer = f"https://{team}"
            # PyJWKClient caches keys and refetches when it sees an unknown `kid` (key rotation).
            self.jwks = jwt.PyJWKClient(f"{self.issuer}/cdn-cgi/access/certs", lifespan=3600)

    def verify(self, token: str | None) -> User:
        if self.bypass:
            return User(self.settings.allowed_email or "dev@localhost")
        if not token:
            raise HTTPException(401, "missing access token")
        try:
            key = self.jwks.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=self.settings.cf_access_aud,
                issuer=self.issuer,
                options={"require": ["exp", "iat", "aud", "iss"]},
                leeway=30,
            )
        except (jwt.PyJWTError, jwt.PyJWKClientError) as err:
            log.info("rejected access token: %s", type(err).__name__)
            raise HTTPException(401, "invalid access token") from err
        email = str(claims.get("email", "")).lower()
        if email != self.settings.allowed_email:
            raise HTTPException(401, "not allowed")
        return User(email)

    def __call__(self, request: Request) -> User:
        return self.verify(request.headers.get(HEADER))
