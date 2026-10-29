"""Explicit, non-destructive import of a legacy database into the active profile.

Never run automatically: the old shared database has no reliable profile owner.
"""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import tempfile

from .paths import data_dir

_REQUIRED_TABLES = {"articles", "events", "user_state", "sources", "event_articles"}


def migrate_legacy_database(source: str | Path, *, apply: bool = False) -> dict:
    source = Path(source).expanduser().resolve(strict=True)
    target = data_dir(create=False) / "intelligence.db"
    if source == target.resolve():
        raise ValueError("Source and destination must be different")
    if target.exists():
        raise FileExistsError("Profile database already exists; refusing to overwrite")
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as old:
        tables = {row[0] for row in old.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not _REQUIRED_TABLES <= tables:
            raise ValueError("Source is not an intelligence-feed database")
        if old.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Source database integrity check failed")
        report = {"source": str(source), "destination": str(target), "status": "dry_run"}
        if not apply:
            return report
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".migration-", suffix=".sqlite", dir=target.parent)
        os.close(fd)
        temporary = Path(name)
        try:
            with closing(sqlite3.connect(temporary)) as snapshot:
                # SQLite backup includes committed WAL data, unlike copying the .db file.
                old.backup(snapshot)
                snapshot.execute("PRAGMA journal_mode=DELETE")
                if snapshot.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Migrated database integrity check failed")
                report["articles"] = snapshot.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
                report["events"] = snapshot.execute("SELECT COUNT(*) FROM events").fetchone()[0]
                report["favorites"] = snapshot.execute("SELECT COUNT(*) FROM user_state WHERE favorite_at IS NOT NULL").fetchone()[0]
            # Atomic no-clobber publication. A concurrent startup/import must win,
            # never be silently replaced. No unsafe os.replace fallback.
            os.link(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    report["status"] = "migrated"
    return report
