"""Synthetic-only regression coverage for browser admission and transport."""
import asyncio
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import HTTPException
from intelligence_feed import browser_service as bs
from dashboard import plugin_api as api
from test_browser_service import FakeWorker, state, create


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(bs, 'data_dir', lambda **kw: tmp_path)
    workers = []
    def factory(root):
        worker = FakeWorker(root)
        workers.append(worker)
        return worker
    manager = bs.BrowserService(worker_factory=factory)
    yield manager, workers
    manager.shutdown()


@pytest.mark.parametrize('code,status', [('stale_view',409), ('invalid_request',400), ('busy',409), ('profile_locked',409)])
def test_pipe_rejections_keep_session_alive(service, code, status):
    manager, workers = service
    script = "import sys,json\nfor line in sys.stdin:\n r=json.loads(line); op=r['op']; print(json.dumps({'id':r['id'],'ok':False,'error':"+repr(code)+"} if op=='paint' else {'id':r['id'],'ok':True,'result':({'closed':True} if op=='close' else "+repr(state())+")}),flush=True)\n if op=='close': break"
    manager.worker_factory = lambda root: bs.PipeWorker([sys.executable,'-I','-u','-c',script], timeout=1)
    id = create(manager)['id']
    worker = manager._sessions[id].worker
    before = manager._sessions[id].last_seen
    with pytest.raises(bs.BrowserError) as caught:
        manager.action(id, 'paint', {'view':0,'seq':1})
    assert caught.value.status == status
    assert caught.value.code == code
    assert not caught.value.fatal
    assert manager._sessions[id].last_seen == before
    assert manager.frame(id)['status'] == 'ready'
    assert worker.process.poll() is None


@pytest.mark.parametrize('code', ['unknownError','browser_error','invalid_state','cleanup_failed','unsafe_profile','password=private'])
def test_unknown_and_fatal_worker_errors_are_not_recoverable(service, code):
    manager, _ = service
    script = "import json\nfor line in __import__('sys').stdin:\n r=json.loads(line);print(json.dumps({'id':r['id'],'ok':True,'result':"+repr(state())+"} if r['op']=='open' else {'id':r['id'],'ok':False,'error':"+repr(code)+"}),flush=True)"
    manager.worker_factory = lambda root: bs.PipeWorker([sys.executable,'-I','-u','-c',script], timeout=.3)
    id = create(manager)['id']
    with pytest.raises(bs.BrowserError) as caught:
        manager.frame(id)
    assert caught.value.status == 503 and caught.value.fatal
    assert 'private' not in str(caught.value)
    assert id not in manager._sessions


@pytest.mark.parametrize('width,height', [(99,600),(2401,600),(900,99),(900,1801),(True,600)])
def test_worker_geometry_invalid_before_launch(service, width, height):
    manager, workers = service
    with pytest.raises(bs.BrowserError) as caught:
        manager.create(dict(scope='s',url='https://example.invalid',width=width,height=height))
    assert caught.value.status == 400 and not workers


@pytest.mark.parametrize('payload', [{'width':99}, {'height':1801}, {'width':2401}, {'scale':True}, {'scale':151}, {'extra':1}])
def test_resize_geometry_invalid_before_rpc(service, payload):
    manager, workers = service
    id = create(manager)['id']
    with pytest.raises(bs.BrowserError) as caught:
        manager.action(id,'resize',payload)
    assert caught.value.status == 400 and len(workers[0].calls)==1
    assert manager.frame(id)['status']=='ready'


def test_queue_is_bounded_and_deadline_includes_lock_wait(service):
    manager, workers = service
    manager.operation_timeout = .08
    manager.max_pending = 2
    id = create(manager)['id']
    session = manager._sessions[id]
    session.lock.acquire()
    try:
        first = manager.prepare('frame', (id,))
        second = manager.prepare('frame', (id,))
        with pytest.raises(bs.BrowserError) as busy:
            manager.prepare('frame', (id,))
        assert busy.value.code == 'busy'
        before = session.last_seen
        start = time.monotonic()
        with pytest.raises(bs.BrowserError) as expired:
            manager.frame(id, _control=first)
        assert expired.value.status == 504 and not expired.value.fatal
        assert time.monotonic()-start < .4
        assert session.last_seen == before and len(workers[0].calls)==1
        second.cancel.set()
        with pytest.raises(bs.BrowserError) as cancelled:
            manager.frame(id, _control=second)
        assert cancelled.value.code == 'cancelled'
    finally:
        session.lock.release()
    assert manager.frame(id)['status']=='ready'


@pytest.mark.parametrize('method,args', [('frame',()),('action',('paint',{'view':1,'seq':1})),('close',()),('clear',(True,))])
def test_cancelled_waiter_never_sends_or_renews_lease(service, method, args):
    manager, workers = service
    id = create(manager)['id']
    session = manager._sessions[id]
    session.lock.acquire()
    control = manager.prepare(method,(id,*args))
    before = session.last_seen
    with ThreadPoolExecutor() as pool:
        future = pool.submit(getattr(manager,method),id,*args,_control=control)
        control.cancel.set()
        try:
            with pytest.raises(bs.BrowserError) as caught:
                future.result(timeout=1)
            assert caught.value.code == 'cancelled'
            assert len(workers[0].calls)==1 and session.last_seen==before
        finally:
            session.lock.release()
    assert manager.frame(id)['status']=='ready'


def test_api_overload_is_rejected_before_executor_submission(service,monkeypatch):
    manager,_=service
    monkeypatch.setattr(api,'browser_service',manager)
    manager.max_pending=1
    id=create(manager)['id']
    reserved=manager.prepare('frame',(id,))
    async def scenario():
        def forbidden(*args,**kwargs): pytest.fail('Overload must not submit another executor thread')
        monkeypatch.setattr(api.asyncio,'to_thread',forbidden)
        with pytest.raises(HTTPException) as caught: await api.browser_frame(id,0)
        assert caught.value.status_code==409
        assert caught.value.headers=={'X-Browser-Error':'busy'}
    try: asyncio.run(scenario())
    finally: manager.release(reserved)


def test_fake_clock_expired_executor_wait_and_fifo(service):
    manager, workers = service
    clock = [10.0]
    manager.clock = lambda: clock[0]
    manager.operation_timeout = 5
    id = create(manager)['id']
    old = manager.prepare('frame',(id,))
    clock[0] = 16
    with pytest.raises(bs.BrowserError) as caught:
        manager.frame(id,_control=old)
    assert caught.value.status == 504 and len(workers[0].calls)==1
    a = manager.prepare('action',(id,))
    b = manager.prepare('action',(id,))
    with ThreadPoolExecutor() as pool:
        later = pool.submit(manager.action,id,'paint',{'view':1,'seq':2},_control=b)
        time.sleep(.03)
        assert len(workers[0].calls)==1
        manager.action(id,'paint',{'view':1,'seq':1},_control=a)
        later.result(timeout=1)
    assert [p['seq'] for op,p in workers[0].calls if op=='paint']==[1,2]


def test_remaining_rpc_budget_uses_absolute_deadline(service):
    manager, _ = service
    clock = [100.0]
    manager.clock = lambda: clock[0]
    manager.operation_timeout = 15
    id = create(manager)['id']
    control = manager.prepare('frame',(id,))
    clock[0] += 12
    class BudgetWorker(bs.PipeWorker):
        def request(self,op,payload,*,timeout=None):
            assert timeout == 3
            return state()
        def stop(self, **kwargs): pass
    manager._sessions[id].worker = BudgetWorker.__new__(BudgetWorker)
    assert manager.frame(id,_control=control)['status']=='ready'


def test_api_cancellation_marks_waiter_and_preserves_context(service,monkeypatch):
    manager, workers = service
    monkeypatch.setattr(api,'browser_service',manager)
    id = create(manager)['id']
    session = manager._sessions[id]
    async def scenario():
        session.lock.acquire()
        task = asyncio.create_task(api.browser_action(id, _Request({'op':'paint','payload':{'view':1,'seq':1}})))
        try:
            await asyncio.sleep(.03)
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
            await asyncio.sleep(.05)
            assert len(workers[0].calls)==1
        finally: session.lock.release()
        await asyncio.sleep(.03)
        assert len(workers[0].calls)==1
        assert (await api.browser_frame(id,0))['status']=='ready'
    asyncio.run(scenario())


class _Request:
    def __init__(self,body):
        self.body=body
        self.disconnected=False
    async def stream(self): yield json.dumps(self.body).encode()
    async def is_disconnected(self): return self.disconnected


def test_http_disconnect_cancels_waiting_action(service,monkeypatch):
    manager,workers=service
    monkeypatch.setattr(api,'browser_service',manager)
    id=create(manager)['id']
    session=manager._sessions[id]
    request=_Request({'op':'paint','payload':{'view':1,'seq':1}})
    async def scenario():
        session.lock.acquire()
        task=asyncio.create_task(api.browser_action(id,request))
        try:
            await asyncio.sleep(.03)
            request.disconnected=True
            done,_=await asyncio.wait([task],timeout=.2)
            assert task in done, 'HTTP disconnect must cancel waiting thread admission'
            with pytest.raises(asyncio.CancelledError): await task
            assert len(workers[0].calls)==1
        finally:
            task.cancel()
            session.lock.release()
            await asyncio.gather(task,return_exceptions=True)
        await asyncio.sleep(.03)
        assert len(workers[0].calls)==1
    asyncio.run(scenario())


def test_api_cancel_before_executor_starts_cannot_send(service,monkeypatch):
    manager,workers=service
    monkeypatch.setattr(api,'browser_service',manager)
    id=create(manager)['id']
    session=manager._sessions[id]
    before=session.last_seen
    async def scenario():
        loop=asyncio.get_running_loop()
        pool=ThreadPoolExecutor(max_workers=1)
        loop.set_default_executor(pool)
        entered=threading.Event(); release=threading.Event()
        def block():
            entered.set(); release.wait(2)
        pool.submit(block)
        assert entered.wait(1)
        task=asyncio.create_task(api.browser_frame(id,0))
        try:
            await asyncio.sleep(.02)
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
        finally: release.set()
        await asyncio.sleep(.06)
        assert len(workers[0].calls)==1 and session.last_seen==before
        assert not session.queue
    asyncio.run(scenario())


def test_api_deadline_expires_while_executor_is_saturated(service,monkeypatch):
    manager,workers=service
    monkeypatch.setattr(api,'browser_service',manager)
    id=create(manager)['id'];manager.operation_timeout=.08
    async def scenario():
        pool=ThreadPoolExecutor(max_workers=1)
        asyncio.get_running_loop().set_default_executor(pool)
        entered=threading.Event();release=threading.Event()
        def block(): entered.set();release.wait(2)
        pool.submit(block);assert entered.wait(1)
        task=asyncio.create_task(api.browser_frame(id,0))
        try:
            done,_=await asyncio.wait([task],timeout=.3)
            assert task in done, 'Absolute HTTP deadline must include executor wait'
            with pytest.raises(HTTPException) as caught: await task
            assert caught.value.status_code==504
        finally:
            task.cancel();release.set()
            await asyncio.gather(task,return_exceptions=True)
        await asyncio.sleep(.05)
        assert len(workers[0].calls)==1
        assert (await api.browser_frame(id,0))['status']=='ready'
    asyncio.run(scenario())


def test_api_real_contextvars_profile_survives_to_thread(tmp_path,monkeypatch):
    from hermes_constants import set_hermes_home_override,reset_hermes_home_override
    # Do not use the data_dir-mocked fixture: exercise actual profile context.
    manager=bs.BrowserService(worker_factory=FakeWorker)
    monkeypatch.setattr(api,'browser_service',manager)
    async def scenario():
        token=set_hermes_home_override(tmp_path/'first')
        try:
            first=await api._browser_call(manager.create,dict(scope='s',url='https://example.invalid'))
            other=set_hermes_home_override(tmp_path/'other')
            try:
                with pytest.raises(HTTPException) as caught:
                    await api.browser_frame(first['id'],0)
                assert caught.value.status_code==404
                second=await api._browser_call(manager.create,dict(scope='s',url='https://example.invalid'))
                assert manager._sessions[second['id']].root.is_relative_to(tmp_path/'other')
            finally: reset_hermes_home_override(other)
            assert (await api.browser_frame(first['id'],0))['status']=='ready'
            assert manager._sessions[first['id']].root.is_relative_to(tmp_path/'first')
        finally: reset_hermes_home_override(token)
    try: asyncio.run(scenario())
    finally: manager.shutdown()


def test_api_recoverable_error_header_and_no_disposal(service,monkeypatch):
    manager,workers=service
    monkeypatch.setattr(api,'browser_service',manager)
    id=create(manager)['id']
    async def scenario():
        for code,status,detail in [('stale_view',409,'Stale browser view'),('busy',409,'Browser busy'),
                                   ('profile_locked',409,'Browser profile in use'),('invalid_request',400,'Invalid request')]:
            workers[0].failure=bs.BrowserError(status,code=code,fatal=False)
            with pytest.raises(HTTPException) as caught:
                await api.browser_frame(id,0)
            assert caught.value.headers=={'X-Browser-Error':code}
            assert caught.value.detail==detail
            workers[0].failure=None
            assert (await api.browser_frame(id,0))['status']=='ready'
    asyncio.run(scenario())


def test_inflight_cancel_does_not_claim_rollback_or_renew_lease(service,monkeypatch):
    manager,workers=service
    monkeypatch.setattr(api,'browser_service',manager)
    id=create(manager)['id']; session=manager._sessions[id]
    entered=threading.Event(); release=threading.Event()
    before=session.last_seen
    original=workers[0].request
    def blocked(op,payload):
        entered.set();release.wait(2)
        return original(op,payload)
    workers[0].request=blocked
    async def scenario():
        task=asyncio.create_task(api.browser_frame(id,0))
        try:
            while not entered.is_set(): await asyncio.sleep(.005)
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
        finally: release.set()
        await asyncio.sleep(.05)
        assert len(workers[0].calls)==2  # Already-dispatched work was not rolled back.
        assert session.last_seen==before and not session.queue
    asyncio.run(scenario())


@pytest.mark.parametrize('width,height,scale',[(100,100,40),(2400,1800,150),(900.5,650.5,80)])
def test_geometry_valid_boundaries_match_worker(service,width,height,scale):
    manager,workers=service
    opened=manager.create(dict(scope='s',url='https://example.invalid',width=width,height=height,scale=scale))
    manager.action(opened['id'],'resize',dict(width=width,height=height,scale=scale))
    assert workers[0].calls[0][1]['width']==width
    assert workers[0].calls[-1][1]==dict(width=width,height=height,scale=scale)


def test_runtime_does_not_advertise_chrome_only(monkeypatch,tmp_path):
    import hermes_constants
    monkeypatch.setattr(hermes_constants,'find_node_executable',lambda _:sys.executable)
    monkeypatch.setattr(bs.subprocess,'run',lambda *a,**k:type('R',(),{'stdout':b'v26.12.1'})())
    for key in ('PROGRAMFILES','PROGRAMFILES(X86)','LOCALAPPDATA'):
        monkeypatch.setenv(key,str(tmp_path))
    chrome = tmp_path/'Google/Chrome/Application/chrome.exe'
    chrome.parent.mkdir(parents=True); chrome.touch()
    assert bs.runtime_command() is None
    edge = tmp_path/'Microsoft/Edge/Application/msedge.exe'
    edge.parent.mkdir(parents=True); edge.touch()
    assert bs.runtime_command() is not None


def test_runtime_non_windows_is_unavailable_without_spawning(monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(bs,'os',SimpleNamespace(name='posix',environ={}))
    def forbidden(*args,**kwargs): pytest.fail('Unsupported platform must not spawn Node')
    monkeypatch.setattr(bs.subprocess,'run',forbidden)
    assert bs.runtime_command() is None


def test_runtime_requires_fixed_system_powershell_for_mutex(monkeypatch,tmp_path):
    import hermes_constants
    monkeypatch.setattr(hermes_constants,'find_node_executable',lambda _:sys.executable)
    monkeypatch.setattr(bs.subprocess,'run',lambda *a,**k:type('R',(),{'stdout':b'v26.12.1'})())
    for key in ('PROGRAMFILES','PROGRAMFILES(X86)','LOCALAPPDATA','SYSTEMROOT'):
        monkeypatch.setenv(key,str(tmp_path))
    edge=tmp_path/'Microsoft/Edge/Application/msedge.exe'
    edge.parent.mkdir(parents=True);edge.touch()
    assert bs.runtime_command() is None
    powershell=tmp_path/'System32/WindowsPowerShell/v1.0/powershell.exe'
    powershell.parent.mkdir(parents=True);powershell.touch()
    assert bs.runtime_command() is not None


def test_fatal_cleanup_does_not_send_another_rpc(service):
    manager,_=service
    code = "import sys,json,time\nfor line in sys.stdin:\n r=json.loads(line)\n if r['op']=='close': time.sleep(30)\n print(json.dumps({'id':r['id'],'ok':True,'result':"+repr(state())+"} if r['op']=='open' else {'id':r['id'],'ok':False,'error':'browser_error'}),flush=True)"
    manager.worker_factory=lambda root:bs.PipeWorker([sys.executable,'-I','-u','-c',code],timeout=3)
    id=create(manager)['id']; worker=manager._sessions[id].worker
    start=time.monotonic()
    with pytest.raises(bs.BrowserError) as caught: manager.frame(id)
    assert caught.value.status==503
    assert time.monotonic()-start<2.5, 'Fatal disposal must not send a new close RPC'
    assert worker.process.poll() is not None


def test_real_pipe_timeout_shares_lock_wait_budget(service):
    manager,_=service
    manager.operation_timeout=.25
    code="import sys,json,time\nr=json.loads(input());print(json.dumps({'id':r['id'],'ok':True,'result':"+repr(state())+"}),flush=True);input();time.sleep(30)"
    manager.worker_factory=lambda root:bs.PipeWorker([sys.executable,'-I','-u','-c',code],timeout=15)
    id=create(manager)['id']; session=manager._sessions[id]
    session.lock.acquire()
    start=time.monotonic()
    with ThreadPoolExecutor() as pool:
        control=manager.prepare('frame',(id,))
        future=pool.submit(manager.frame,id,_control=control)
        try: time.sleep(.16)
        finally: session.lock.release()
        with pytest.raises(bs.BrowserError) as caught: future.result(timeout=3)
    assert caught.value.status==504 and caught.value.fatal
    assert time.monotonic()-start<2.5
    assert not manager._sessions


def test_job_contains_children_created_before_first_rpc():
    if os.name!='nt': pytest.skip('Windows job')
    import _winapi
    code="import sys,json,subprocess,time;c=subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(30)']);r=json.loads(input());print(json.dumps({'id':r['id'],'ok':True,'result':{'pid':c.pid}}),flush=True);time.sleep(.1)"
    worker=bs.PipeWorker([sys.executable,'-I','-u','-c',code],timeout=1)
    handle=None
    try:
        pid=worker.request('open',{})['pid']
        handle=_winapi.OpenProcess(0x00100000,False,pid)
        worker.process.wait(timeout=2)
        worker.stop()
        assert _winapi.WaitForSingleObject(handle,1000)==0
    finally:
        worker.stop()
        if handle is not None: _winapi.CloseHandle(handle)


def test_windows_job_popen_failure_closes_handle(monkeypatch):
    if os.name!='nt': pytest.skip('Windows job')
    jobs=[]; original=bs._WindowsJob
    def job():
        result=original();jobs.append(result);return result
    def fail(*args,**kwargs): raise OSError('private synthetic Popen failure')
    monkeypatch.setattr(bs,'_WindowsJob',job)
    monkeypatch.setattr(bs.subprocess,'Popen',fail)
    with pytest.raises(bs.BrowserError) as caught: bs.PipeWorker(['fake'])
    assert str(caught.value)=='Browser unavailable' and jobs[0].handle is None


def test_windows_job_set_limits_failure_closes_handle(monkeypatch):
    if os.name!='nt': pytest.skip('Windows job')
    import ctypes
    original=ctypes.WinDLL
    closed=[]
    class Function:
        def __init__(self,fn): self.fn=fn
        def __call__(self,*args): return self.fn(*args)
    class Api:
        CreateJobObjectW=Function(lambda *args:12345)
        SetInformationJobObject=Function(lambda *args:False)
        AssignProcessToJobObject=Function(lambda *args:True)
        CloseHandle=Function(lambda handle:closed.append(handle) or True)
    monkeypatch.setattr(ctypes,'WinDLL',lambda name,*a,**kw:Api() if name=='kernel32' else original(name,*a,**kw))
    with pytest.raises(bs.BrowserError): bs._WindowsJob()
    assert closed==[12345]


def test_windows_resume_failure_reaps_suspended_owned_process(monkeypatch,tmp_path):
    if os.name!='nt': pytest.skip('Windows job')
    import ctypes
    original = ctypes.WinDLL
    jobs=[]; processes=[]
    real_assign = bs._WindowsJob.assign_and_resume
    class ResumeFailure:
        def __call__(self,*args): return -1
    class Ntdll:
        NtResumeProcess = ResumeFailure()
    def dll(name,*args,**kwargs):
        return Ntdll() if name=='ntdll' else original(name,*args,**kwargs)
    def tracked(job,process):
        jobs.append(job);processes.append(process)
        real_assign(job,process)
    monkeypatch.setattr(ctypes,'WinDLL',dll)
    monkeypatch.setattr(bs._WindowsJob,'assign_and_resume',tracked)
    marker=tmp_path/'must-not-exist'
    with pytest.raises(bs.BrowserError):
        bs.PipeWorker([sys.executable,'-I','-c',f'from pathlib import Path;Path({str(marker)!r}).touch()'])
    assert not marker.exists()
    assert jobs[0].handle is None and processes[0].poll() is not None
    assert processes[0].stdin.closed and processes[0].stdout.closed
