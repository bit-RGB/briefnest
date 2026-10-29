# tests/conftest.py
import pytest
from hermes_constants import set_hermes_home_override, reset_hermes_home_override

from intelligence_feed.db import connect


@pytest.fixture(autouse=True)
def profile_home(tmp_path, monkeypatch):
    # Every test owns its home; never allow a default-path test to touch user data.
    monkeypatch.setenv("INTELLIGENCE_FEED_DATA_DIR", str(tmp_path))
    token = set_hermes_home_override(tmp_path)
    try:
        yield tmp_path
    finally:
        reset_hermes_home_override(token)


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_FEED_DATA_DIR", str(tmp_path))
    c = connect()
    yield c
    c.close()
