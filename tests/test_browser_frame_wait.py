"""Offline REST admission and lifecycle checks for the frame-only lane."""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dashboard import plugin_api as api
from intelligence_feed import browser_service as bs
from test_browser_service import FakeWorker, create, state


@pytest.fixture
def session(tmp_path, monkeypatch):
    monkeypatch.setattr(bs, 'data_dir', lambda **kw: tmp_path)
    entered, release = threading.Event(), threading.Event()

    class Worker(FakeWorker):
        def request(self, op, payload):
            if op == 'frame' and payload.get('wait_ms'):
                self.calls.append((op, payload))
                entered.set()
                assert release.wait(2)
                return state(10)
            if op == 'close':
                release.set()
            return super().request(op, payload)

    manager = bs.BrowserService(worker_factory=Worker, max_pending=1)
    monkeypatch.setattr(api, 'browser_service', manager)
    id = create(manager)['id']
    yield manager, id, entered, release
    release.set()
    manager.shutdown()


@pytest.mark.parametrize('query', ['-1', '1001', '1.0', 'true', '', '1&wait_ms=2'])
def test_wait_query_accepts_only_one_bounded_integer(session, query):
    _, id, entered, _ = session
    app = FastAPI()
    app.include_router(api.router)
    with TestClient(app) as client:
        assert client.get(f'/browser/sessions/{id}/frame?wait_ms={query}').status_code in {400, 422}
    assert not entered.is_set()


def test_wait_reserves_one_slot_before_executor_and_never_blocks_controls(session, monkeypatch):
    manager, id, entered, release = session
    with ThreadPoolExecutor() as pool:
        pending = pool.submit(manager.frame, id, 10, 1000)
        assert entered.wait(1), 'positive wait never reached the worker'

        def forbidden(*args, **kwargs):
            pytest.fail('A second wait must not enter the executor')

        with monkeypatch.context() as patch:
            patch.setattr(api.asyncio, 'to_thread', forbidden)
            with pytest.raises(api.HTTPException) as busy:
                asyncio.run(api.browser_frame(id, 10, wait_ms=1000))
        assert busy.value.headers == {'X-Browser-Error': 'busy'}
        assert pool.submit(manager.action, id, 'paint', {'view': 1, 'seq': 1}).result(.5) == {'ok': True}
        assert not pending.done()
        release.set()
        assert pending.result(1) == state(10)
        assert manager.frame(id, 10, 1000) == state(10)


@pytest.mark.parametrize('stop', ['close', 'shutdown'])
def test_wait_does_not_hold_the_session_lock_during_close_or_shutdown(session, stop):
    manager, id, entered, _ = session
    with ThreadPoolExecutor() as pool:
        pending = pool.submit(manager.frame, id, 10, 1000)
        assert entered.wait(1), 'positive wait never reached the worker'
        args = (id,) if stop == 'close' else ()
        pool.submit(getattr(manager, stop), *args).result(.5)
        pending.result(1)
        assert id not in manager._sessions


def test_cancelled_http_wait_keeps_slot_until_rpc_finishes_without_renewing_lease(session):
    manager, id, entered, release = session
    current = manager._sessions[id]
    before = current.last_seen

    async def scenario():
        task = asyncio.create_task(api.browser_frame(id, 10, wait_ms=1000))
        try:
            assert await asyncio.to_thread(entered.wait, 1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            with pytest.raises(api.HTTPException) as busy:
                await api.browser_frame(id, 10, wait_ms=1000)
            assert busy.value.headers == {'X-Browser-Error': 'busy'}
        finally:
            task.cancel()
            release.set()

    asyncio.run(scenario())
    assert current.frame_waiter is None and current.last_seen == before


def test_close_already_in_progress_refuses_new_wait_admission(session):
    manager, id, _, _ = session
    worker = manager._sessions[id].worker
    request = worker.request
    closing, complete = threading.Event(), threading.Event()

    def block_close(op, payload):
        if op == 'close':
            closing.set()
            assert complete.wait(2)
        return request(op, payload)

    worker.request = block_close
    with ThreadPoolExecutor() as pool:
        closed = pool.submit(manager.close, id)
        try:
            assert closing.wait(1)
            with pytest.raises(bs.BrowserError) as rejected:
                manager.prepare('frame', (id, 0, 1000))
            assert rejected.value.status == 404
        finally:
            complete.set()
        assert closed.result(1) == {'closed': True}
