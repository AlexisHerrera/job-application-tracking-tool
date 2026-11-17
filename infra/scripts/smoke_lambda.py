"""Pre-deploy smoke test, run by smoke-lambda.sh inside AWS's own Lambda image (Python 3.12, arm64)
with the built package as /var/task. No network, no AWS: it proves the zip works on the real
runtime (native wheels, imports) before anything is deployed.

1. Every module the Lambdas can load imports (the CLI and the evals don't run in Lambda).
2. The API handler answers a Function URL event: /api/health is 200, a protected route is 401.
3. The ingest and discover handlers exist (calling them would read mail or the job boards).
"""

from __future__ import annotations

import importlib
import json
import os
import pkgutil
import sys

# What the api Lambda has in prod, with placeholder IDs. No SSM_SECRETS, so no SSM call at cold
# start; the 401 comes before any Cognito key fetch.
os.environ.update(
    APP_ENV="prod",
    AWS_LAMBDA_FUNCTION_NAME="jobtracker-api-smoke",
    AWS_DEFAULT_REGION="us-east-1",
    COGNITO_USER_POOL_ID="us-east-1_smoketest",
    COGNITO_CLIENT_ID="smoketest",
    COGNITO_DOMAIN="smoke.auth.us-east-1.amazoncognito.com",
    ALLOWED_EMAIL="smoke@example.com",
    APP_URL="https://smoke.example.com",
    DSQL_ENDPOINT="smoke.dsql.us-east-1.on.aws",
    DSQL_USER="jobtracker_api",
)

import jobtracker  # noqa: E402

failures: list[str] = []
count = 0
for mod in pkgutil.walk_packages(jobtracker.__path__, "jobtracker."):
    if mod.name.startswith(("jobtracker.cli", "jobtracker.evals")):
        continue
    try:
        importlib.import_module(mod.name)
        count += 1
    except Exception as err:
        failures.append(f"import {mod.name}: {type(err).__name__}: {err}")


def url_event(path: str) -> dict:
    """A Lambda Function URL request (payload format 2.0), as CloudFront sends it."""
    return {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": path,
        "rawQueryString": "",
        "headers": {"host": "smoke.lambda-url.us-east-1.on.aws", "accept": "application/json"},
        "requestContext": {
            "accountId": "anonymous",
            "apiId": "smoke",
            "domainName": "smoke.lambda-url.us-east-1.on.aws",
            "domainPrefix": "smoke",
            "http": {
                "method": "GET",
                "path": path,
                "protocol": "HTTP/1.1",
                "sourceIp": "127.0.0.1",
                "userAgent": "smoke",
            },
            "requestId": "smoke",
            "routeKey": "$default",
            "stage": "$default",
            "time": "01/Jan/2026:00:00:00 +0000",
            "timeEpoch": 1767225600000,
        },
        "isBase64Encoded": False,
    }


try:
    from jobtracker.lambdas import handlers

    for path, want in (("/api/health", 200), ("/api/applications", 401)):
        resp = handlers.api(url_event(path), None)
        got = resp.get("statusCode")
        if got != want:
            failures.append(f"GET {path}: {got} (want {want}): {str(resp.get('body'))[:200]}")
        elif path == "/api/health" and json.loads(resp["body"]) != {"ok": True}:
            failures.append(f"GET /api/health body: {resp['body'][:200]}")
    for name in ("ingest", "discover"):
        if not callable(getattr(handlers, name, None)):
            failures.append(f"handlers.{name} is missing")
except Exception as err:
    failures.append(f"api handler: {type(err).__name__}: {err}")

print(f"python {sys.version.split()[0]}, {os.uname().machine}: imported {count} modules")
if failures:
    print("\n".join(f"FAIL {f}" for f in failures))
    sys.exit(1)
print("ok: imports, /api/health 200, /api/applications 401")
