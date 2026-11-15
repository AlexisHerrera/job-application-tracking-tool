"""Starting data shipped with the app (plan §21)."""

from __future__ import annotations

import csv
from importlib import resources


def read_boards(text: str) -> list[dict]:
    """Rows of a board CSV. Accepts this package's columns (ats, slug, name, note) and the
    LastRound AI directory's (ats_vendor, board_slug, company_name)."""
    return [
        {
            "ats": (r.get("ats") or r.get("ats_vendor") or "").strip().lower(),
            "slug": (r.get("slug") or r.get("board_slug") or "").strip(),
            "name": (r.get("name") or r.get("company_name") or "").strip(),
            "note": (r.get("note") or "").strip(),
        }
        for r in csv.DictReader(text.splitlines())
    ]


def watchlist() -> list[dict]:
    """The starting company watchlist: boards that had an engineering role in Latin America or
    worldwide when the LastRound AI directory (CC BY 4.0) was scanned on 2026-11-14."""
    return read_boards(
        resources.files(__package__).joinpath("ats_watchlist.csv").read_text("utf-8")
    )
