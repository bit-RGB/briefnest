"""Synthetic credentials only; exercise the real Hermes context-local resolver."""
import asyncio
import traceback
import urllib.error
from contextlib import contextmanager
from types import SimpleNamespace
from urllib.parse import quote, quote_plus

import pytest
from agent import secret_scope

from intelligence_feed import collector, service, sources

NAME = "BRIEFNEST_TEST_API_KEY"
SOURCE = dict(id="scoped", domain="music", name="Scoped", adapter="feed",
              url="https://example.invalid/feed", api_key_env=NAME)


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    from intelligence_feed import fetch
    def denied(*args, **kwargs):
        pytest.fail("Real network forbidden")
    monkeypatch.setattr(fetch, "urlopen", denied)


@contextmanager
def profile(home, mapping):
    mode = secret_scope.set_multiplex_context(True)
    token = secret_scope.set_secret_scope(mapping, profile_home=str(home))
    try:
        yield
    finally:
        secret_scope.reset_secret_scope(token)
        secret_scope.reset_multiplex_context(mode)


def variants(value):
    return {value, quote(value, safe=""), quote_plus(value, safe="")}


@pytest.mark.parametrize("label,key", [("alice", "alice/ +key"), ("bob", "bob/ +key")])
def test_fetch_and_service_use_only_active_profile(tmp_path, monkeypatch, label, key):
    monkeypatch.setenv(NAME, "wrong-process-key")
    monkeypatch.setattr(sources, "load_sources", lambda: [SOURCE])
    calls = []
    def fetch(url, **kwargs):
        calls.append(url)
        return SimpleNamespace(not_modified=False, body=b"<rss><channel/></rss>", etag=None, last_modified=None)
    monkeypatch.setattr(sources, "fetch_url", fetch)
    with profile(tmp_path / label, {NAME: key}):
        assert sources.fetch_source(SOURCE).status == "success"
        assert calls == [SOURCE["url"] + "?api_key=" + quote(key, safe="")]
        assert service.configured_credentials() == variants(key)


def test_scoped_miss_never_uses_process_key(tmp_path, monkeypatch, conn):
    monkeypatch.setenv(NAME, "wrong-process-key")
    monkeypatch.setattr(sources, "load_sources", lambda: [SOURCE])
    monkeypatch.setattr(sources, "fetch_url", lambda *a, **k: pytest.fail("network on scoped miss"))
    with profile(tmp_path / "empty", {}):
        assert sources.fetch_source(SOURCE).status == "skipped_missing_credential"
        assert service.configured_credentials() == set()
        result = collector.run_update(source_loader=lambda: [SOURCE], clock=lambda: 0)
        assert result.error_count == 0
        assert conn.execute("SELECT status FROM source_runs").fetchone()[0] == "skipped_missing_credential"


@pytest.mark.parametrize("key", ["alice/ +key", "bob/ +key"])
def test_collector_redacts_scoped_raw_and_encoded_keys(tmp_path, monkeypatch, conn, capsys, key):
    monkeypatch.setenv(NAME, "wrong-process-key")
    def fail(*args):
        raise ValueError("diagnostic " + " ".join(variants(key)))
    with profile(tmp_path / key.split('/')[0], {NAME: key}):
        result = collector.run_update(source_loader=lambda: [SOURCE], source_fetcher=fail, clock=lambda: 0)
    error = conn.execute("SELECT error FROM source_runs").fetchone()[0]
    assert result.error_count == 1
    assert all(value not in error for value in variants(key))
    assert "[REDACTED]" in error
    assert capsys.readouterr() == ("", "")


@pytest.mark.parametrize("http_error", [True, False])
def test_source_errors_never_expose_scoped_key(tmp_path, monkeypatch, http_error):
    key = "private/ +key"
    monkeypatch.setenv(NAME, "wrong-process-key")
    def fail(url, **kwargs):
        message = "diagnostic " + " ".join(variants(key))
        if http_error:
            raise urllib.error.HTTPError(url, 403, message, None, None)
        raise ValueError(message)
    monkeypatch.setattr(sources, "fetch_url", fail)
    with profile(tmp_path / "alice", {NAME: key}):
        with pytest.raises(Exception) as caught:
            sources.fetch_source(SOURCE)
    rendered = "".join(traceback.format_exception(caught.type, caught.value, caught.tb))
    exposed = rendered + repr(caught.value) + str(getattr(caught.value, "url", ""))
    assert all(value not in exposed for value in variants(key))
    if http_error:
        assert caught.value.code == 403


@pytest.mark.parametrize("label,key", [("alice", "alice/ +key"), ("bob", "bob/ +key")])
def test_events_url_validation_uses_active_profile_key(tmp_path, monkeypatch, label, key):
    from dashboard import plugin_api as api
    monkeypatch.setenv(NAME, "wrong-process-key")
    monkeypatch.setattr(sources, "load_sources", lambda: [SOURCE])
    urls = ["https://example.invalid/" + value for value in variants(key)]
    monkeypatch.setattr(service, "list_events", lambda **kwargs: {
        "items": [{"url": url} for url in urls], "next_cursor": None,
    })
    with profile(tmp_path / label, {NAME: key}):
        result = api.events(profile="display-state", domain="all", read="all", q="", limit=30, cursor=None)
    assert all(item["url"] == "" for item in result["items"])


def test_nested_profiles_restore_scope_without_cached_keys(tmp_path, monkeypatch):
    monkeypatch.setenv(NAME, "wrong-process-key")
    monkeypatch.setattr(sources, "load_sources", lambda: [SOURCE])
    with profile(tmp_path / "alice", {NAME: "alice-synthetic"}):
        assert service.configured_credentials() == {"alice-synthetic"}
        with profile(tmp_path / "bob", {NAME: "bob-synthetic"}):
            assert service.configured_credentials() == {"bob-synthetic"}
        assert service.configured_credentials() == {"alice-synthetic"}


def test_unscoped_multiplex_read_fails_closed(monkeypatch):
    monkeypatch.setenv(NAME, "wrong-process-key")
    mode = secret_scope.set_multiplex_context(True)
    token = secret_scope.set_secret_scope(None)
    try:
        with pytest.raises(secret_scope.UnscopedSecretError):
            sources.fetch_source(SOURCE)
    finally:
        secret_scope.reset_secret_scope(token)
        secret_scope.reset_multiplex_context(mode)


def test_update_worker_preserves_profile_context(tmp_path, monkeypatch):
    from dashboard import plugin_api as api
    observed = []
    def update():
        observed.append((secret_scope.current_secret_scope_home(), secret_scope.get_secret(NAME)))
        return SimpleNamespace(to_dict=lambda: {"status": "success"})
    monkeypatch.setattr(service, "run_update", update)
    async def run(label):
        with profile(tmp_path / label, {NAME: label + "-synthetic"}):
            assert await api.updates() == {"status": "success"}
    asyncio.run(run("alice"))
    asyncio.run(run("bob"))
    assert observed == [(str(tmp_path / label), label + "-synthetic") for label in ("alice", "bob")]
