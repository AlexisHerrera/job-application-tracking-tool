"""The Discover page's buttons in AWS: the API starts the discover Lambda and returns at once.

A run takes minutes, longer than CloudFront waits for an answer, so the invoke is asynchronous
("Event"). The run writes its progress to DSQL (core/discovery_progress), which the page polls.
One attempt only: botocore's retries would start a second run.
"""

from __future__ import annotations

import json


class DiscoverStartFailed(Exception):
    pass


class LambdaDiscover:
    def __init__(self, function_name: str, client=None):
        self.function_name = function_name
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
                    read_timeout=10,
                    retries={"mode": "standard", "total_max_attempts": 1},
                ),
            )
        return self._client

    def __call__(self, payload: dict) -> None:
        from botocore.exceptions import ClientError

        try:
            resp = self.client.invoke(
                FunctionName=self.function_name,
                InvocationType="Event",
                Payload=json.dumps({"trigger": "page", **payload}).encode(),
            )
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") == "TooManyRequestsException":
                raise DiscoverStartFailed("AWS is throttling Lambda right now; try again") from err
            raise
        if resp.get("StatusCode") != 202:
            raise DiscoverStartFailed(f"the discover Lambda answered {resp.get('StatusCode')}")
