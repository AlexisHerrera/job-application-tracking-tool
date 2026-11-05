"""Amazon Cognito ID-token validation (plan §6). This is what closes the cloudfront.net / Function
URL bypass: without a token signed by our user pool, for our app client and our email, every
route but /api/health answers 401.

The token travels in its own header. `Authorization` is taken: CloudFront's OAC overwrites it
with the SigV4 signature it sends to the Lambda Function URL.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request

from jobtracker.settings import Settings

log = logging.getLogger(__name__)

HEADER = "X-Id-Token"


@dataclass(frozen=True)
class User:
    email: str


def cognito_issuer(user_pool_id: str) -> str:
    region = user_pool_id.split("_", 1)[0]  # pool ids look like us-east-1_AbC123
    return f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"


class TokenVerifier:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.bypass = settings.auth_dev_bypass
        if not self.bypass:
            if not (
                settings.cognito_user_pool_id
                and settings.cognito_client_id
                and settings.allowed_email
            ):
                raise RuntimeError(
                    "COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID and ALLOWED_EMAIL are required "
                    "unless AUTH_DEV_BYPASS=true (local only)"
                )
            self.issuer = cognito_issuer(settings.cognito_user_pool_id)
            # PyJWKClient caches keys and refetches when it sees an unknown `kid` (key rotation).
            self.jwks = jwt.PyJWKClient(f"{self.issuer}/.well-known/jwks.json", lifespan=3600)

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
                audience=self.settings.cognito_client_id,
                issuer=self.issuer,
                options={"require": ["exp", "iat", "aud", "iss", "sub"]},
                leeway=30,
            )
        except (jwt.PyJWTError, jwt.PyJWKClientError) as err:
            log.info("rejected access token: %s", type(err).__name__)
            raise HTTPException(401, "invalid access token") from err
        # An access token from the same pool has no `aud` and fails above; this keeps it explicit.
        if claims.get("token_use") != "id":
            raise HTTPException(401, "invalid access token")
        email = str(claims.get("email", "")).lower()
        if email != self.settings.allowed_email or claims.get("email_verified") is not True:
            raise HTTPException(401, "not allowed")
        return User(email)

    def __call__(self, request: Request) -> User:
        return self.verify(request.headers.get(HEADER))
