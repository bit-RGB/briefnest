"""Opt-in real FastAPI -> Python -> JSONL -> owned Edge smoke test.

Run with BRIEFNEST_REAL_BROWSER_TEST=1. Only fresh scratch profiles and the
public example.com page are used. This does NOT operate Hermes UI/accounts or
claim QR/SMS login acceptance. No frames, cookies or debugging addresses persist.
"""
import hashlib
import os
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dashboard import plugin_api as api
from intelligence_feed import browser_service as bs


@pytest.mark.skipif(os.environ.get("BRIEFNEST_REAL_BROWSER_TEST") != "1",
                    reason="explicit opt-in for an owned real browser")
def test_real_api_worker_mouse_close_clear_and_abrupt_restart(tmp_path, monkeypatch):
    homes = {"a": tmp_path / "profile-a", "b": tmp_path / "profile-b"}
    active = ["a"]

    def own_data_dir(*, create=True):
        root = homes[active[0]]
        if create:
            root.mkdir(parents=True, exist_ok=True)
        return root

    monkeypatch.setattr(bs, "data_dir", own_data_dir)
    service = bs.BrowserService(lease_seconds=60)
    monkeypatch.setattr(api, "browser_service", service)
    app = FastAPI()
    prefix = "/api/plugins/intelligence-feed"
    app.include_router(api.router, prefix=prefix)
    scope = '["fixture-local","fixture-a","fixture-a"]'
    root = homes["a"] / "browser" / hashlib.sha256(scope.encode()).hexdigest()
    sentinel = homes["a"] / "news-sentinel"
    homes["a"].mkdir(parents=True)
    sentinel.write_text("keep", encoding="utf-8")

    with TestClient(app) as client:
        def create():
            response = client.post(prefix + "/browser/sessions", json=dict(
                scope=scope, url="https://example.com", width=800, height=600, scale=80))
            assert response.status_code == 200, "real owned browser could not open"
            result = response.json()
            assert isinstance(result.get("id"), str)
            assert result["rememberLogin"] is True
            assert (result["width"], result["height"]) == (1000, 750)
            return result["id"]

        def base(id):
            return prefix + "/browser/sessions/" + id

        def action(id, op, payload):
            return client.post(base(id) + "/action", json={"op": op, "payload": payload})

        def ready(id):
            for _ in range(100):
                response = client.get(base(id) + "/frame?after_seq=0")
                assert response.status_code == 200, "frame polling lost its owned session"
                state = response.json()
                frame = state.get("frame")
                if frame and state.get("origin"):
                    ack = action(id, "paint", {"view": state["view"], "seq": frame["seq"]})
                    if ack.status_code == 200:
                        return state
                    assert ack.status_code in (400, 409), "stale paint destroyed the browser"
                time.sleep(.1)
            pytest.fail("owned example page never produced an acknowledged frame")

        try:
            assert client.get(prefix + "/browser/status").json()["available"] is True
            first = create()
            state = ready(first)
            view = state["view"]
            # Exact production React mouse envelope, not the old abbreviated one.
            for kind in ("mouseMoved", "mousePressed", "mouseReleased", "mouseWheel"):
                payload = dict(type=kind, x=20, y=20, view=view,
                               button="none" if kind in ("mouseMoved", "mouseWheel") else "left",
                               buttons=1 if kind == "mousePressed" else 0,
                               modifiers=0, clickCount=1)
                if kind == "mouseWheel":
                    payload.update(deltaX=0, deltaY=120)
                assert action(first, "mouse", payload).status_code == 200, "production mouse schema rejected"
            for kind in ("keyDown", "keyUp"):
                assert action(first, "key", dict(type=kind, key="Escape", code="Escape",
                                                 windowsVirtualKeyCode=27, modifiers=0, view=view)).status_code == 200
            # A stale input is a rejected operation, not a dead browser/profile.
            assert action(first, "text", {"text": "synthetic", "view": view - 1}).status_code in (400, 409)
            assert client.get(base(first) + "/frame").status_code == 200
            # A future cursor makes this a deterministic empty wait in the
            # actual REST -> Python -> JSONL -> Edge chain.
            started = time.monotonic()
            waited = client.get(base(first) + "/frame?after_seq=9007199254740991&wait_ms=350")
            assert waited.status_code == 200
            assert waited.json()["frame"] is None
            assert time.monotonic() - started >= .30, "wait_ms was ignored in the real chain"
            active[0] = "b"
            assert client.get(base(first) + "/frame").status_code == 404
            active[0] = "a"
            assert client.delete(base(first)).json() == {"closed": True}
            assert (root / "edge-profile").is_dir(), "close deleted remembered login profile"
            second = create()
            assert second != first
            ready(second)
            if os.name == "nt":
                # Kill only the JobObject created by THIS test; no PID/name scans.
                worker = service._sessions[second].worker
                worker._job.close()
                for _ in range(100):
                    if worker.process.poll() is not None and second not in service._sessions:
                        break
                    time.sleep(.05)
                assert second not in service._sessions
                assert (root / "edge-profile").is_dir()
                second = create()
                ready(second)
            assert client.post(base(second) + "/clear", json={"confirm": False}).status_code == 400
            assert (root / "edge-profile").is_dir()
            response = client.post(base(second) + "/clear", json={"confirm": True})
            assert response.status_code == 200, "owned clear failed"
            assert response.json() == {"cleared": True}
            assert not (root / "edge-profile").exists()
            assert sentinel.read_text(encoding="utf-8") == "keep"
            assert client.get(base(second) + "/frame").status_code == 404
            third = create()
            ready(third)
            assert client.delete(base(third)).json() == {"closed": True}
        finally:
            service.shutdown()
