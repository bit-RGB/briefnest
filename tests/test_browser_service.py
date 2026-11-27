"""Offline contract tests. Fake workers never launch or inspect a browser."""
import asyncio
import hashlib
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from intelligence_feed import browser_service as bs
from dashboard import plugin_api as api


def state(seq=1):
    return dict(view=1, seq=seq, origin="https://example.invalid", status="ready",
                width=900, height=600, rememberLogin=True, frame=None)


class FakeWorker:
    def __init__(self, root):
        self.root = root
        self.calls = []
        self.stopped = False
        self.failure = None
    def request(self, op, payload):
        self.calls.append((op, payload))
        if self.failure:
            raise self.failure
        if op == "clear":
            return {"cleared": True}
        if op == "close":
            return {"closed": True}
        if op == "paint":
            return {"ok": True}
        return state(len(self.calls))
    def stop(self):
        self.stopped = True


@pytest.fixture
def setup(tmp_path, monkeypatch):
    current = [tmp_path / "a"]
    monkeypatch.setattr(bs, "data_dir", lambda **kw: current[0])
    workers = []
    def factory(root):
        w = FakeWorker(root)
        workers.append(w)
        return w
    manager = bs.BrowserService(worker_factory=factory, lease_seconds=5)
    yield manager, workers, current
    manager.shutdown()


def create(manager, scope="local/profile"):
    return manager.create(dict(scope=scope, url="https://example.invalid/article", width=900, height=600, scale=80))


def test_scope_hash_and_current_profile_opaque_ids(setup):
    manager, workers, current = setup
    a = create(manager, "../../same")
    root = workers[0].root
    assert root == current[0].resolve() / "browser" / hashlib.sha256(b"../../same").hexdigest()
    current[0] = current[0].parent / "b"
    with pytest.raises(bs.BrowserError) as error:
        manager.frame(a["id"], 0)
    assert error.value.status == 404
    b = create(manager, "../../same")
    assert a["id"] != b["id"] and workers[1].root != root


def test_scope_exclusive_close_retains_profile_and_clear_explicit(setup):
    manager, workers, current = setup
    a = create(manager)
    with pytest.raises(bs.BrowserError) as error:
        create(manager)
    assert error.value.status == 409 and len(workers) == 1
    marker = workers[0].root / "edge-profile" / "simulated-login"
    marker.parent.mkdir(parents=True)
    marker.write_text("synthetic", encoding="utf-8")
    assert manager.close(a["id"]) == {"closed": True}
    assert workers[0].stopped and marker.exists()
    b = create(manager)
    for confirm in (False, 1, "true", None):
        with pytest.raises(bs.BrowserError):
            manager.clear(b["id"], confirm)
    assert workers[-1].calls == [("open", dict(url="https://example.invalid/article", width=900, height=600, scale=80))]
    assert manager.clear(b["id"], True) == {"cleared": True}
    assert workers[-1].calls[-1] == ("clear", {})
    assert marker.exists(), "Python must never delete directories itself; worker owns clear"
    assert not (current[0] / "intelligence.db").exists()


@pytest.mark.parametrize("field,value", [("scope", ""), ("scope", "a" * 513), ("width", True),
    ("width", 0), ("height", 9000), ("scale", 39), ("scale", 151),
    ("url", "https://name:secret@example.invalid"), ("url", "file:///secret"),
    ("url", "https://example.invalid/\nsecret")])
def test_open_rejects_input_before_worker(setup, field, value):
    manager, workers, _ = setup
    body = dict(scope="s", url="https://example.invalid", width=900, height=600, scale=80)
    body[field] = value
    with pytest.raises(bs.BrowserError) as error:
        manager.create(body)
    assert error.value.status == 400 and not workers


def test_failure_releases_scope_sanitizes_and_closes_owned_worker(setup):
    manager, workers, _ = setup
    a = create(manager)
    workers[0].failure = RuntimeError("password=private ws://debug/private")
    with pytest.raises(bs.BrowserError) as error:
        manager.frame(a["id"], 0)
    assert str(error.value) == "Browser unavailable"
    assert workers[0].stopped
    assert create(manager)["id"] != a["id"]


def test_idle_lease_closes_without_clear(setup):
    manager, workers, _ = setup
    manager.lease_seconds = 0.08
    a = create(manager)
    time.sleep(0.04)
    manager.frame(a["id"], 0)
    time.sleep(0.05)
    assert not workers[0].stopped
    deadline = time.monotonic() + 2
    while not workers[0].stopped and time.monotonic() < deadline:
        time.sleep(0.01)
    assert workers[0].stopped
    assert workers[0].calls[-1] == ("close", {})
    assert not any(op == "clear" for op, _ in workers[0].calls)
    with pytest.raises(bs.BrowserError):
        manager.frame(a["id"], 0)


def test_narrow_actions_and_result_fields(setup):
    manager, workers, _ = setup
    a = create(manager)
    for op in ("evaluate", "cookies", "close", "clear", "__proto__"):
        with pytest.raises(bs.BrowserError):
            manager.action(a["id"], op, {})
    assert manager.action(a["id"], "paint", {"view": 1, "seq": 1}) == {"ok": True}
    assert set(manager.frame(a["id"], 1)) == set(state())


def test_profile_root_symlink_escape_is_refused(setup, tmp_path):
    manager, workers, current = setup
    current[0].mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    try:
        (current[0] / "browser").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Windows symlink privilege unavailable")
    with pytest.raises(bs.BrowserError):
        create(manager)
    assert not workers


FAKE_PIPE = '''import sys,json,time,threading
lock=threading.Lock()
def reply(r):
 op=r['op']
 if op=='hang': time.sleep(10); return
 if op=='exit': sys.exit(0)
 if op=='oversize':
  with lock: print('x'*5000,flush=True)
  return
 if op=='invalid':
  with lock: print(json.dumps({'id':r['id'],'ok':False,'error':'password=private ws://debug/private'}),flush=True)
  return
 if op=='wrong':
  with lock: print(json.dumps({'id':r['id']+999,'ok':True,'result':{}}),flush=True)
  return
 time.sleep(r['payload'].get('delay',0))
 with lock: print(json.dumps({'id':r['id'],'ok':True,'result':{'n':r['payload'].get('n')}}),flush=True)
for line in sys.stdin:
 r=json.loads(line)
 if r['op']=='exit': break
 if r['op']=='close':
  print(json.dumps({'id':r['id'],'ok':True,'result':{'closed':True}}),flush=True);break
 threading.Thread(target=reply,args=(r,),daemon=True).start()
'''


def pipe(**kw):
    return bs.PipeWorker([sys.executable, "-I", "-u", "-c", FAKE_PIPE], timeout=0.3, max_line=4096, **kw)


def test_pipe_pairs_concurrent_response_ids():
    worker = pipe()
    try:
        with ThreadPoolExecutor() as pool:
            slow = pool.submit(worker.request, "frame", {"n": 1, "delay": 0.08})
            fast = pool.submit(worker.request, "frame", {"n": 2})
            assert fast.result() == {"n": 2}
            assert slow.result() == {"n": 1}
    finally:
        worker.stop()
    assert worker.process.poll() is not None


@pytest.mark.parametrize("op,status", [("hang", 504), ("exit", 503), ("oversize", 503), ("invalid", 503), ("wrong", 503)])
def test_pipe_timeout_exit_size_and_error_are_bounded_and_redacted(op, status):
    worker = pipe()
    start = time.monotonic()
    try:
        with pytest.raises(bs.BrowserError) as error:
            worker.request(op, {})
        assert error.value.status == status
        assert "private" not in str(error.value) and "debug" not in str(error.value)
    finally:
        worker.stop()
    assert time.monotonic() - start < 3
    assert worker.process.poll() is not None


def test_descriptor_scope_and_control_characters(setup):
    manager, workers, _ = setup
    scope = json.dumps(["local", "me", "me"], separators=(",", ":"))
    assert create(manager, scope)["id"]
    assert workers[0].root.name == hashlib.sha256(scope.encode()).hexdigest()
    assert create(manager, "s" * 512)["id"]
    for control in ("\x00", "\n", "\x1f", "\x7f"):
        with pytest.raises(bs.BrowserError):
            create(manager, "scope" + control)


def test_locked_profile_refuses_without_takeover_and_can_retry(setup):
    manager, workers, _ = setup
    factory = manager.worker_factory
    def locked(root):
        worker = factory(root)
        worker.failure = bs.BrowserError(409)
        return worker
    manager.worker_factory = locked
    with pytest.raises(bs.BrowserError) as error:
        create(manager)
    assert error.value.status == 409 and workers[0].stopped
    assert workers[0].calls[0][0] == "open"
    manager.worker_factory = factory
    assert create(manager)["id"]


def test_result_strips_diagnostics_and_keeps_no_frame_history(setup):
    import base64
    manager, workers, _ = setup
    id = create(manager)["id"]
    sample = state(10)
    sample.update(origin="https://example.invalid/article?token=private", debug="ws://private")
    sample["frame"] = dict(data=base64.b64encode(b"\x89PNG\r\n\x1a\nsynthetic").decode(), seq=10, format="png", view=1, debug="private")
    workers[0].request = lambda *args: sample
    output = manager.frame(id, 0)
    assert output["origin"] == "https://example.invalid"
    assert "debug" not in output and "debug" not in output["frame"]
    assert not any("frame" in vars(s) for s in manager._sessions.values())
    sample["frame"] = None
    assert manager.frame(id, 10)["frame"] is None


def test_pipe_large_response_does_not_timeout_on_bytewise_reads():
    code = "import sys,json; r=json.loads(input()); print(json.dumps({'id':r['id'],'ok':True,'result':{'data':'x'*2000000}}),flush=True); input()"
    worker = bs.PipeWorker([sys.executable, "-I", "-u", "-c", code], timeout=1)
    try:
        assert len(worker.request("frame", {})["data"]) == 2000000
    finally:
        worker.stop()


@pytest.mark.parametrize("response", [
    {"ok": False, "error": {"password": "private"}},
    {"ok": True, "result": []},
    {"ok": False, "error": "PROFILE_LOCKED", "debug": "private"},
])
def test_malformed_child_response_is_immediate_fixed_failure(response):
    code = "import sys,json; r=json.loads(input()); out=" + repr(response) + ";out['id']=r['id'];print(json.dumps(out),flush=True);input()"
    worker = bs.PipeWorker([sys.executable, "-I", "-u", "-c", code], timeout=0.3)
    try:
        with pytest.raises(bs.BrowserError) as error:
            worker.request("frame", {})
        assert error.value.status == 503
    finally:
        worker.stop()


@pytest.mark.parametrize("status", ["switching", "limited"])
def test_worker_navigation_statuses_are_supported(setup, status):
    manager, workers, _ = setup
    id = create(manager)["id"]
    result = state()
    result["status"] = status
    workers[0].request = lambda *args: result
    assert manager.frame(id, 0)["status"] == status


def test_real_home_override_is_resolved_each_call(tmp_path):
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    workers = []
    def factory(root):
        worker = FakeWorker(root)
        workers.append(worker)
        return worker
    manager = bs.BrowserService(worker_factory=factory)
    token = set_hermes_home_override(tmp_path / "first")
    try:
        first = create(manager)
        assert workers[0].root.is_relative_to(tmp_path / "first" / "plugin-data" / "intelligence-feed")
        second_token = set_hermes_home_override(tmp_path / "second")
        try:
            with pytest.raises(bs.BrowserError) as error:
                manager.close(first["id"])
            assert error.value.status == 404
            assert create(manager)["id"] != first["id"]
        finally:
            reset_hermes_home_override(second_token)
        assert manager.close(first["id"]) == {"closed": True}
    finally:
        manager.shutdown()
        reset_hermes_home_override(token)


@pytest.mark.parametrize("op", ["open", "clear", "frame"])
def test_failure_paths_close_and_keep_database_untouched(setup, op):
    manager, workers, current = setup
    current[0].mkdir(parents=True)
    database = current[0] / "intelligence.db"
    database.write_bytes(b"synthetic-db-sentinel")
    if op == "open":
        factory = manager.worker_factory
        def fail_open(root):
            worker = factory(root)
            worker.failure = bs.BrowserError(504)
            return worker
        manager.worker_factory = fail_open
        action = lambda: create(manager)
    else:
        id = create(manager)["id"]
        workers[0].failure = bs.BrowserError(504)
        action = (lambda: manager.clear(id, True)) if op == "clear" else (lambda: manager.frame(id, 0))
    with pytest.raises(bs.BrowserError) as error:
        action()
    assert error.value.status == 504
    assert workers[0].stopped and not manager._sessions and not manager._scopes
    assert database.read_bytes() == b"synthetic-db-sentinel"


def test_transport_unicode_request_stays_within_worker_jsonl_limit():
    code = "import sys,json; raw=sys.stdin.buffer.readline(); r=json.loads(raw); print(json.dumps({'id':r['id'],'ok':True,'result':{'bytes':len(raw)}}),flush=True); input()"
    worker = bs.PipeWorker([sys.executable, "-I", "-u", "-c", code], timeout=0.5)
    try:
        result = worker.request("text", {"text": "音" * 3000, "view": 1})
        assert result["bytes"] < 16384
    finally:
        worker.stop()


def test_child_exit_reaps_session_without_waiting_for_lease(tmp_path, monkeypatch):
    monkeypatch.setattr(bs, "data_dir", lambda **kw: tmp_path)
    code = "import json,time; r=json.loads(input()); print(json.dumps({'id':r['id'],'ok':True,'result':" + repr(state()) + "}),flush=True); time.sleep(0.1)"
    workers = []
    def factory(root):
        worker = bs.PipeWorker([sys.executable, "-I", "-u", "-c", code], timeout=0.5)
        workers.append(worker)
        return worker
    manager = bs.BrowserService(worker_factory=factory, lease_seconds=60)
    try:
        id = create(manager)["id"]
        deadline = time.monotonic() + 2
        while manager._sessions and time.monotonic() < deadline:
            time.sleep(0.01)
        assert not manager._sessions and not manager._scopes
        assert workers[0].process.poll() is not None
    finally:
        manager.shutdown()


@pytest.mark.parametrize("result", [dict(state(), view="password=private"), {"ok": True}, {"ok": 1}])
def test_frame_rejects_non_state_or_untyped_worker_fields(setup, result):
    manager, workers, _ = setup
    id = create(manager)["id"]
    workers[0].request = lambda *args: result
    with pytest.raises(bs.BrowserError) as error:
        manager.frame(id, 0)
    assert error.value.status == 503 and "private" not in str(error.value)


@pytest.mark.parametrize("operation,result", [("close", {"closed": False}), ("close", {"closed": 1}), ("clear", {"cleared": 1})])
def test_lifecycle_requires_exact_confirmed_child_ack(setup, operation, result):
    manager, workers, _ = setup
    id = create(manager)["id"]
    workers[0].request = lambda *args: result
    with pytest.raises(bs.BrowserError):
        manager.close(id) if operation == "close" else manager.clear(id, True)
    assert workers[0].stopped and not manager._sessions


def test_forced_stop_reaps_owned_fake_descendants_on_windows():
    import os
    import subprocess
    if os.name != "nt":
        pytest.skip("Windows process-tree cleanup")
    import _winapi
    code = "import sys,json,subprocess,time; r=json.loads(input()); c=subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(30)']); print(json.dumps({'id':r['id'],'ok':True,'result':{'pid':c.pid}}),flush=True); input(); time.sleep(30)"
    worker = bs.PipeWorker([sys.executable, "-I", "-u", "-c", code], timeout=0.2)
    handle = None
    pid = None
    try:
        pid = worker.request("open", {})["pid"]
        handle = _winapi.OpenProcess(0x00100000, False, pid)
        worker.stop()
        assert _winapi.WaitForSingleObject(handle, 1000) == 0
    finally:
        worker.stop()
        if handle is not None:
            if _winapi.WaitForSingleObject(handle, 0) != 0:
                subprocess.run(["taskkill.exe", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=3)
            _winapi.CloseHandle(handle)


@pytest.mark.parametrize("parent_exits", [False, True])
def test_stop_reaps_owned_descendants_without_touching_unrelated_process(parent_exits):
    import os
    import subprocess
    if os.name != "nt":
        pytest.skip("Windows process-tree cleanup")
    import _winapi
    # All processes are synthetic. The worker may disappear before stop(),
    # leaving a child that a live-parent-only taskkill strategy cannot find.
    code = (
        "import sys,json,subprocess,time; r=json.loads(input()); "
        "c=subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(30)']); "
        "print(json.dumps({'id':r['id'],'ok':True,'result':{'pid':c.pid}}),flush=True); "
        + ("time.sleep(0.05)" if parent_exits else "input(); time.sleep(30)")
    )
    unrelated = subprocess.Popen([sys.executable, "-I", "-c", "import time;time.sleep(30)"])
    worker = bs.PipeWorker([sys.executable, "-I", "-u", "-c", code], timeout=0.3)
    child_handle = None
    pid = None
    try:
        pid = worker.request("open", {})["pid"]
        child_handle = _winapi.OpenProcess(0x00100000, False, pid)
        if parent_exits:
            worker.process.wait(timeout=2)
        worker.stop()
        worker.stop()  # Repeated disposal must be safe.
        assert _winapi.WaitForSingleObject(child_handle, 1000) == 0
        assert unrelated.poll() is None
    finally:
        worker.stop()
        if child_handle is not None:
            if _winapi.WaitForSingleObject(child_handle, 0) != 0:
                subprocess.run(["taskkill.exe", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=3)
            _winapi.CloseHandle(child_handle)
        unrelated.terminate()
        unrelated.wait(timeout=3)


def test_windows_job_assignment_failure_is_closed_and_does_not_run_worker(monkeypatch):
    import os
    if os.name != "nt":
        pytest.skip("Windows process-tree cleanup")
    jobs = []
    processes = []
    def refuse(job, process):
        jobs.append(job)
        processes.append(process)
        raise OSError("synthetic assignment failure with private details")
    monkeypatch.setattr(bs._WindowsJob, "assign_and_resume", refuse)
    with pytest.raises(bs.BrowserError) as error:
        bs.PipeWorker([sys.executable, "-I", "-c", "raise RuntimeError('must remain suspended')"])
    assert str(error.value) == "Browser unavailable"
    assert len(processes) == 1 and processes[0].poll() is not None
    assert jobs[0].handle is None
    assert processes[0].stdin.closed and processes[0].stdout.closed


def test_windows_job_creation_failure_does_not_launch_worker(monkeypatch):
    import os
    if os.name != "nt":
        pytest.skip("Windows process-tree cleanup")
    launches = []
    def refuse():
        raise OSError("synthetic job failure with private details")
    monkeypatch.setattr(bs, "_WindowsJob", refuse)
    monkeypatch.setattr(bs.subprocess, "Popen", lambda *args, **kwargs: launches.append(args))
    with pytest.raises(bs.BrowserError) as error:
        bs.PipeWorker([sys.executable, "-I", "-c", "pass"])
    assert str(error.value) == "Browser unavailable" and not launches


def test_child_environment_allowlist(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "private")
    monkeypatch.setenv("HERMES_HOME", "private")
    env = bs.worker_environment()
    assert "OPENAI_API_KEY" not in env and "HERMES_HOME" not in env
    assert not any("SECRET" in key or "TOKEN" in key for key in env)


@pytest.fixture
def client(setup, monkeypatch):
    manager, _, _ = setup
    monkeypatch.setattr(api, "browser_service", manager)
    app = FastAPI()
    app.include_router(api.router)
    with TestClient(app) as client:
        yield client


def api_create(client):
    return client.post("/browser/sessions", json=dict(scope="scope", url="https://example.invalid", width=900, height=600, scale=80))


def test_rest_lifecycle_and_profile_isolation(client, setup):
    _, workers, current = setup
    response = api_create(client)
    assert response.status_code == 200
    id = response.json()["id"]
    assert client.get(f"/browser/sessions/{id}/frame?after_seq=0").status_code == 200
    assert client.post(f"/browser/sessions/{id}/action", json={"op": "paint", "payload": {"view": 1, "seq": 1}}).json() == {"ok": True}
    assert client.post(f"/browser/sessions/{id}/clear", json={"confirm": 1}).status_code == 400
    old = current[0]
    current[0] = old.parent / "b"
    for method, path in (("get", f"/browser/sessions/{id}/frame"), ("delete", f"/browser/sessions/{id}"), ("post", f"/browser/sessions/{id}/clear")):
        assert getattr(client, method)(path, **({"json": {"confirm": True}} if method == "post" else {})).status_code == 404
    current[0] = old
    assert client.post(f"/browser/sessions/{id}/clear", json={"confirm": True}).json() == {"cleared": True}
    assert workers[0].stopped
    id = api_create(client).json()["id"]
    assert client.delete(f"/browser/sessions/{id}").json() == {"closed": True}


@pytest.mark.parametrize("content", [b"{", b"[]", b"null", b'{"scope":"private", "url":', b"x" * 16385])
def test_api_bounded_body_fixed_errors(client, content):
    response = client.post("/browser/sessions", content=content)
    assert response.status_code == (413 if len(content) > 16384 else 400)
    assert response.json() == {"detail": "Request too large" if len(content) > 16384 else "Invalid request"}


def test_api_action_and_clear_body_bounds(client):
    id = api_create(client).json()["id"]
    for suffix in ("action", "clear"):
        response = client.post(f"/browser/sessions/{id}/{suffix}", content=b"p" * 16385)
        assert response.status_code == 413 and "ppp" not in response.text


def test_streamed_body_limit_without_content_length(client):
    def chunks():
        for _ in range(17):
            yield b"x" * 1024
    assert client.post("/browser/sessions", content=chunks()).status_code == 413


def test_status_does_not_start_browser(client, setup, monkeypatch):
    manager, workers, _ = setup
    monkeypatch.setattr(bs, "runtime_command", lambda root=None: ["node", "worker"])
    assert client.get("/browser/status").json() == {"available": True, "rememberLogin": True}
    assert not workers
    monkeypatch.setattr(bs, "runtime_command", lambda root=None: None)
    assert client.get("/browser/status").json() == {"available": False, "rememberLogin": True}


def test_api_failure_is_fixed_and_does_not_log_input(client, setup, caplog):
    _, workers, _ = setup
    id = api_create(client).json()["id"]
    workers[0].failure = RuntimeError("private password and ws://debug")
    response = client.get(f"/browser/sessions/{id}/frame")
    assert response.status_code == 503
    assert response.json() == {"detail": "Browser unavailable"}
    assert "private" not in caplog.text and "ws://" not in caplog.text


def test_routes_are_async_and_worker_operations_do_not_block_loop(setup, monkeypatch):
    manager, workers, _ = setup
    monkeypatch.setattr(api, "browser_service", manager)
    id = create(manager)["id"]
    original = workers[0].request
    def delayed(*args):
        time.sleep(0.1)
        return original(*args)
    workers[0].request = delayed
    async def scenario():
        task = asyncio.create_task(api.browser_frame(id, 0))
        await asyncio.sleep(0.02)
        assert not task.done()
        await task
    asyncio.run(scenario())
