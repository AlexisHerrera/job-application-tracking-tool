"""Where a discovery run is, kept in discovery_settings['progress'] so the page can follow a run
that happens elsewhere (prod: the discover Lambda; the API only reads). Locally the API keeps
progress in memory instead, since the run happens in its own process.

The row is written at most every few seconds, and always on a phase change and at the end. A run
that died (timeout, crash) leaves a row that never says "done": it counts as finished once it
hasn't moved for STALE.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, fields
from datetime import datetime, timedelta

from jobtracker.core.discovery import Progress
from jobtracker.core.ports import Clock, DiscoveryRepo

log = logging.getLogger(__name__)

KEY = "progress"
WRITE_EVERY = timedelta(seconds=3)
# Longer than any one step stays silent: a search that times out, or six slow LLM answers.
STALE = timedelta(minutes=3)
_DATES = ("started_at", "phase_started_at", "finished_at")


def to_dict(p: Progress, now: datetime) -> dict:
    d = asdict(p)
    for k in _DATES:
        d[k] = d[k].isoformat() if d[k] else None
    d["updated_at"] = now.isoformat()
    return d


def from_dict(d: object) -> tuple[Progress, datetime] | None:
    """The stored progress and when it was written, or None if there's none (or it's unreadable)."""
    if not isinstance(d, dict):
        return None
    try:
        known = {f.name for f in fields(Progress)}
        values = {k: v for k, v in d.items() if k in known}
        for k in _DATES:
            values[k] = datetime.fromisoformat(values[k]) if values.get(k) else None
        return Progress(**values), datetime.fromisoformat(d["updated_at"])
    except (KeyError, TypeError, ValueError):
        return None


def load(repo: DiscoveryRepo, now: datetime) -> Progress | None:
    """The last run's progress. One that stopped moving is closed here (not in the database): the
    page then sees it as finished."""
    got = from_dict(repo.get_discovery_setting(KEY))
    if got is None:
        return None
    p, updated_at = got
    if p.phase != "done" and now - updated_at > STALE:
        p.phase, p.finished_at = "done", updated_at
    return p


def running(repo: DiscoveryRepo, now: datetime) -> bool:
    p = load(repo, now)
    return p is not None and p.phase != "done"


def save(repo: DiscoveryRepo, p: Progress, now: datetime) -> None:
    with repo.transaction():
        repo.set_discovery_setting(KEY, to_dict(p, now))


class ProgressWriter:
    """An `on_progress` for run_discovery / rescore that writes to the database, throttled."""

    def __init__(self, repo: DiscoveryRepo, clock: Clock):
        self.repo = repo
        self.clock = clock
        self._last_write: datetime | None = None
        self._last_phase: str | None = None

    def __call__(self, p: Progress) -> None:
        now = self.clock.now()
        due = self._last_write is None or now - self._last_write >= WRITE_EVERY
        if due or p.phase != self._last_phase:
            try:
                save(self.repo, p, now)
            except Exception as err:  # the page's view of the run must never stop the run
                log.warning("discovery progress not saved: %s", err)
                return
            self._last_write, self._last_phase = now, p.phase
