"""The job sources the saved searches read, by source name. The same set locally (CLI, page) and
in the discover Lambda. None of them needs a key."""

from __future__ import annotations

from jobtracker.core.ports import JobSource


def discovery_sources() -> dict[str, JobSource]:
    from jobtracker.adapters.getonbrd import GetOnBoardSource
    from jobtracker.adapters.remoteyeah import RemoteYeahSource
    from jobtracker.adapters.workable import WorkableSource

    return {
        "remoteyeah": RemoteYeahSource(),
        "getonbrd": GetOnBoardSource(),
        "workable": WorkableSource(),
    }
