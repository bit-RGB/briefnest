from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from pathlib import Path
import sqlite3

import pytest
import hermes_constants
from intelligence_feed import db, paths
from intelligence_feed.models import SourceItem
from intelligence_feed.repository import upsert_item, set_favorite


def test_data_path_is_resolved_for_each_profile_not_cached(tmp_path, monkeypatch):
    monkeypatch.setenv('INTELLIGENCE_FEED_DATA_DIR', str(tmp_path / 'shared-override'))
    first, second = tmp_path / 'alpha', tmp_path / 'beta'
    for home in (first, second, first):
        token = hermes_constants.set_hermes_home_override(home)
        try:
            assert paths.database_path() == home / 'plugin-data' / 'intelligence-feed' / 'intelligence.db'
        finally:
            hermes_constants.reset_hermes_home_override(token)


def test_two_profiles_have_independent_records_and_thread_context(tmp_path):
    def read_or_create(home, insert=False):
        token = hermes_constants.set_hermes_home_override(home)
        try:
            with ThreadPoolExecutor(1) as executor:
                assert executor.submit(copy_context().run, paths.database_path).result() == home / 'plugin-data' / 'intelligence-feed' / 'intelligence.db'
            conn = db.connect()
            try:
                if insert:
                    event_id, _ = upsert_item(conn, SourceItem('source', 'ai', 'Source', 'https://example.com/one', 'Example title', '', None))
                    set_favorite(conn, 'default', event_id, True)
                return conn.execute('SELECT COUNT(*) FROM articles').fetchone()[0], conn.execute('SELECT COUNT(*) FROM user_state WHERE favorite_at IS NOT NULL').fetchone()[0]
            finally:
                conn.close()
        finally:
            hermes_constants.reset_hermes_home_override(token)
    assert read_or_create(tmp_path / 'alpha', True) == (1, 1)
    assert read_or_create(tmp_path / 'beta') == (0, 0)
    assert read_or_create(tmp_path / 'alpha') == (1, 1)


def seed_legacy(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute('PRAGMA journal_mode=WAL')
    db.migrate(conn)
    conn.row_factory = sqlite3.Row
    event_id, _ = upsert_item(conn, SourceItem('source', 'ai', 'Source', 'https://example.com/one', 'Historical title', '', None))
    set_favorite(conn, 'default', event_id, True)
    return conn


def test_explicit_migration_snapshots_wal_and_preserves_history(tmp_path):
    from intelligence_feed.migration import migrate_legacy_database
    source = tmp_path / 'legacy' / 'intelligence.db'
    live = seed_legacy(source)
    before = source.read_bytes()
    destination = paths.database_path()
    try:
        plan = migrate_legacy_database(source)
        assert plan['status'] == 'dry_run'
        assert not destination.exists()
        result = migrate_legacy_database(source, apply=True)
        assert result['status'] == 'migrated'
        assert source.exists()
        assert source.read_bytes() == before
        conn = db.connect()
        try:
            assert conn.execute('SELECT title FROM articles').fetchone()[0] == 'Historical title'
            assert conn.execute('SELECT COUNT(*) FROM user_state WHERE favorite_at IS NOT NULL').fetchone()[0] == 1
            assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        finally:
            conn.close()
        with pytest.raises(FileExistsError):
            migrate_legacy_database(source, apply=True)
    finally:
        live.close()


def test_migration_never_imports_legacy_data_automatically(tmp_path):
    source = tmp_path / 'data' / 'intelligence-feed' / 'intelligence.db'
    conn = seed_legacy(source)
    conn.close()
    target = db.connect()
    try:
        assert target.execute('SELECT COUNT(*) FROM articles').fetchone()[0] == 0
    finally:
        target.close()


def test_bad_migration_does_not_publish_partial_database(tmp_path):
    from intelligence_feed.migration import migrate_legacy_database
    source = tmp_path / 'corrupt.sqlite'
    source.write_bytes(b'not sqlite')
    with pytest.raises((ValueError, sqlite3.DatabaseError)):
        migrate_legacy_database(source, apply=True)
    assert not paths.database_path().exists()
