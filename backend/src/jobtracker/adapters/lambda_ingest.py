"""The scan button in AWS: the API invokes the ingest Lambda and waits for its report.

Aurora DSQL has no advisory locks, so the API can't guard an in-process scan the way it does
locally. The ingest Lambda takes a lease in DSQL instead, and a run that finds it taken (the
scheduled run, or another scan, is going) answers `{"busy": true}`, which we report as "already
running". Only one attempt is made: botocore's default retries would invoke the function again.
"""

from __future__ import annotations

import json
import logging

log = logging.getLogger(__name__)


class IngestBusy(Exception):
    """Another ingest run holds the lease."""


class IngestStillRunning(Exception):
    """We stopped waiting; the run carries on and its results show up when it ends."""


class IngestFailed(Exception):
    pass


class LambdaIngest:
    def __init__(self, function_name: str, wait_seconds: int = 50, client=None):
        self.function_name = function_name
        self.wait_seconds = wait_seconds
        self._client = client

    @property
    def client(self):
        if self._client is None:
            import boto3
            from botocore.config import Config

            self._client = boto3.client(
                "lambda",
                config=Config(
                    connect_timeout=5,
                    read_timeout=self.wait_seconds,
                    retries={"mode": "standard", "total_max_attempts": 1},
                ),
            )
        return self._client

    def __call__(self) -> dict:
        from botocore.exceptions import ClientError, ReadTimeoutError

        try:
            resp = self.client.invoke(
                FunctionName=self.function_name,
                InvocationType="RequestResponse",
                Payload=json.dumps({"trigger": "scan"}).encode(),
            )
        except ReadTimeoutError as err:
            raise IngestStillRunning() from err
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") == "TooManyRequestsException":
                # The account's concurrency is used up (it's small on new accounts).
                raise IngestFailed(
                    "AWS is throttling Lambda right now; try again in a minute"
                ) from err
            raise
        payload = json.loads(resp["Payload"].read() or b"null")
        if resp.get("FunctionError"):
            message = (payload or {}).get("errorMessage") or resp["FunctionError"]
            log.error("ingest failed: %s", message)
            raise IngestFailed(str(message))
        if (payload or {}).get("busy"):
            raise IngestBusy()
        return payload or {}
