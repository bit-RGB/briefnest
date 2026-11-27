"""Profile-scoped persistent preview workers; no browser data is read by Python.

The JSONL child is the sole owner of its Chromium context and on-disk lock.
All public methods are synchronous, bounded operations intended for to_thread.
No request, child output, frame, URL, or exception is logged or persisted here.
"""
from __future__ import annotations

import atexit
import base64
from contextlib import contextmanager
from concurrent.futures import Future, TimeoutError as FutureTimeout
from dataclasses import dataclass, field
import hashlib
import io
import json
import math
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time
from urllib.parse import urlsplit

from .paths import data_dir

BODY_LIMIT = 16 * 1024
PIPE_LIMIT = 12 * 1024 * 1024
FRAME_LIMIT = 10 * 1024 * 1024
FRAME_WAIT_MAX_MS = 1000
ACTIONS = frozenset({"navigate", "reload", "back", "resize", "mouse", "text", "key", "paint"})


class BrowserError(Exception):
    """Only locally chosen, fixed messages may cross the REST boundary."""
    def __init__(self, status=503, *, code=None, fatal=True):
        self.status = status if status in {400, 404, 409, 413, 503, 504} else 503
        self.detail = {400: "Invalid request", 404: "Not found", 409: "Browser profile in use",
                       413: "Request too large", 503: "Browser unavailable",
                       504: "Browser operation timed out"}[self.status]
        defaults = {400: 'invalid_request', 404: 'not_found', 409: 'profile_locked',
                    413: 'request_too_large', 503: 'browser_unavailable', 504: 'timeout'}
        self.code = code if code in {'stale_view', 'busy', 'cancelled'} else defaults[self.status]
        self.fatal = fatal
        self.detail = {'stale_view': 'Stale browser view', 'busy': 'Browser busy',
                       'cancelled': 'Browser operation cancelled'}.get(self.code, self.detail)
        super().__init__(self.detail)


def worker_environment():
    # Do not inherit provider keys, proxy credentials, NODE_OPTIONS, PYTHONPATH,
    # Hermes profile settings, or arbitrary environment variables.
    allowed = {"SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP",
               "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432"}
    return {k: v for k, v in os.environ.items() if k.upper() in allowed}


def runtime_command(root=None):
    """Discover only binaries/runtime; never launch a browser for status."""
    if os.name != 'nt':
        return None
    try:
        # The worker's profile mutex uses only this fixed system executable,
        # not PATH lookup. Status probes existence without launching PowerShell.
        system_root = os.environ.get('SystemRoot') or os.environ.get('SYSTEMROOT') or 'C:/Windows'
        powershell = Path(system_root) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        if not powershell.is_file():
            return None
        from hermes_constants import find_node_executable
        node = find_node_executable("node")
        worker = Path(__file__).resolve().parents[1] / "browser" / "worker.cjs"
        if not node or not worker.is_file():
            return None
        version = subprocess.run([node, "--version"], capture_output=True, timeout=2,
                                 env=worker_environment(), check=True).stdout.decode("ascii").strip()
        if int(version.removeprefix("v").split(".")[0]) < 26:
            return None
        # Browser binary discovery is deliberately independent of browser profiles.
        candidates = []
        for key in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            base = next((v for k, v in os.environ.items() if k.upper() == key), "")
            if base:
                candidates.append(Path(base) / "Microsoft/Edge/Application/msedge.exe")
        if not any(p.is_file() for p in candidates):
            return None
        result = [str(node), str(worker)]
        if root is not None:
            result.extend(["--profile-root", str(root)])
        return result
    except Exception:
        return None


class _WindowsJob:
    """Handle-owned process containment; never rediscover descendants by PID.

    The worker starts suspended and is resumed only after assignment, so even
    children created before the first RPC cannot escape this private job.
    Closing the last non-inheritable handle kills surviving job members,
    including descendants whose worker parent has already exited.
    """
    def __init__(self):
        import ctypes
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
                        ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
                        ("max_working_set", ctypes.c_size_t), ("active_limit", wintypes.DWORD),
                        ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                        ("scheduling", wintypes.DWORD)]

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in
                        ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [("basic", BasicLimits), ("io", IoCounters),
                        ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                        ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]

        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.api.CreateJobObjectW.restype = wintypes.HANDLE
        self.api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.api.SetInformationJobObject.restype = wintypes.BOOL
        self.api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.api.AssignProcessToJobObject.restype = wintypes.BOOL
        self.api.CloseHandle.argtypes = [wintypes.HANDLE]
        self.api.CloseHandle.restype = wintypes.BOOL
        self.handle = self.api.CreateJobObjectW(None, None)
        if not self.handle:
            raise BrowserError()
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.close()
            raise BrowserError()

    def assign_and_resume(self, process):
        import ctypes
        from ctypes import wintypes
        # Popen retains this exact process handle; PID reuse cannot select an
        # unrelated process. Failure leaves the owned worker suspended.
        if not self.api.AssignProcessToJobObject(self.handle, int(process._handle)):
            raise BrowserError()
        resume = ctypes.WinDLL("ntdll").NtResumeProcess
        resume.argtypes = [wintypes.HANDLE]
        resume.restype = ctypes.c_long
        if resume(int(process._handle)) != 0:
            raise BrowserError()

    def close(self):
        if self.handle is not None:
            handle, self.handle = self.handle, None
            if not self.api.CloseHandle(handle):
                raise BrowserError()


class PipeWorker:
    """Bounded JSONL RPC with one reader and id-paired concurrent callers."""
    def __init__(self, command, *, timeout=15, max_line=PIPE_LIMIT):
        self.timeout = timeout
        self.max_line = max_line
        self._lock = threading.RLock()
        self._write_lock = threading.Lock()
        self._stop_lock = threading.Lock()
        self._pending = {}
        self._serial = 0
        self._broken = False
        self._exit_callback = None
        self._exit_notified = False
        self._job = None
        self.process = None
        try:
            if os.name == "nt":
                self._job = _WindowsJob()
            self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                            stderr=subprocess.DEVNULL, env=worker_environment(),
                                            bufsize=0, creationflags=((subprocess.CREATE_NO_WINDOW | 0x4) if os.name == "nt" else 0))
            if self._job:
                self._job.assign_and_resume(self.process)
        except Exception:
            # Assignment/resume failure must not leave an uncontained or
            # suspended process. Never fall back to launching without a job.
            try:
                if self.process is not None:
                    if self.process.poll() is None:
                        self.process.terminate()
                    self.process.wait(timeout=1)
                    for stream in (self.process.stdin, self.process.stdout):
                        if stream:
                            stream.close()
            finally:
                if self._job:
                    self._job.close()
            raise BrowserError() from None
        self._stdout = io.BufferedReader(self.process.stdout)
        self._reader = threading.Thread(target=self._read, name="briefnest-rpc", daemon=True)
        self._reader.start()

    def set_exit_callback(self, callback):
        with self._lock:
            self._exit_callback = callback
        self._notify_exit()

    def _notify_exit(self):
        with self._lock:
            if not self._broken or not self._exit_callback or self._exit_notified:
                return
            self._exit_notified = True
            callback = self._exit_callback
        # Never run disposal on the reader thread or re-enter a session lock
        # held by a request discovering the timeout.
        threading.Thread(target=callback, name="briefnest-worker-exit", daemon=True).start()

    def _fail(self, status=503):
        with self._lock:
            self._broken = True
            pending, self._pending = self._pending, {}
        for future in pending.values():
            if not future.done():
                future.set_exception(BrowserError(status))
        self._notify_exit()

    def _read(self):
        try:
            while True:
                line = self._stdout.readline(self.max_line + 1)
                if not line or len(line) > self.max_line or not line.endswith(b"\n"):
                    raise BrowserError()
                message = json.loads(line)
                if (not isinstance(message, dict) or type(message.get("id")) is not int
                        or type(message.get("ok")) is not bool):
                    raise BrowserError()
                if message["ok"]:
                    if set(message) != {"id", "ok", "result"} or not isinstance(message["result"], dict):
                        raise BrowserError()
                elif set(message) != {"id", "ok", "error"} or not isinstance(message["error"], str):
                    raise BrowserError()
                with self._lock:
                    future = self._pending.pop(message["id"], None)
                if future is None:
                    raise BrowserError()
                if message["ok"] is True:
                    future.set_result(message["result"])
                else:
                    # Never relay child error text. Unknown codes fail closed.
                    code = message["error"]
                    if code in {"PROFILE_LOCKED", "PROFILE_IN_USE", "profile_locked", "profile_in_use", "locked"}:
                        error = BrowserError(409, fatal=False)
                    elif code in {"INVALID_REQUEST", "invalid_request", "INVALID_INPUT", "invalid_input"}:
                        error = BrowserError(400, fatal=False)
                    elif code in {'stale_view', 'busy', 'cancelled'}:
                        error = BrowserError(409, code=code, fatal=False)
                    else:
                        error = BrowserError()
                    future.set_exception(error)
        except Exception:
            self._fail()

    def request(self, op, payload, *, timeout=None):
        deadline = time.monotonic() + (self.timeout if timeout is None else min(self.timeout, timeout))
        if deadline <= time.monotonic():
            raise BrowserError(504, fatal=False)
        with self._lock:
            if self._broken or self.process.poll() is not None:
                raise BrowserError()
            self._serial += 1
            id = self._serial
            future = Future()
            self._pending[id] = future
        try:
            packet = json.dumps({"id": id, "op": op, "payload": payload}, allow_nan=False,
                                separators=(",", ":"), ensure_ascii=False).encode("utf-8") + b"\n"
            if len(packet) - 1 > BODY_LIMIT:
                raise BrowserError(413)
            # A blocked pipe write must not bypass the RPC timeout. One daemon
            # sender per request is bounded by the control lock and frame slot.
            def send():
                try:
                    with self._write_lock:
                        self.process.stdin.write(packet)
                        self.process.stdin.flush()
                except Exception:
                    self._fail()
            threading.Thread(target=send, name="briefnest-rpc-send", daemon=True).start()
            return future.result(timeout=max(0, deadline - time.monotonic()))
        except FutureTimeout:
            self._fail(504)
            raise BrowserError(504) from None
        except BrowserError:
            raise
        except Exception:
            self._fail()
            raise BrowserError() from None
        finally:
            with self._lock:
                self._pending.pop(id, None)

    def _terminate_owned_tree(self):
        # The non-inheritable job handle contains only the worker assigned
        # through its Popen handle and descendants. It remains authoritative
        # even after the root exits; never walk or signal recycled PIDs.
        if self._job:
            self._job.close()
        elif self.process.poll() is None:
            self.process.terminate()

    def stop(self, *, graceful=True):
        # Only the Popen process tree created here is signalled, never by name.
        with self._stop_lock:
            try:
                if graceful and self.process.poll() is None and not self._broken:
                    try:
                        self.request("close", {})
                    except BrowserError:
                        pass
                if self.process.stdin:
                    self.process.stdin.close()
                try:
                    self.process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    self._terminate_owned_tree()
                    try:
                        self.process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        self.process.kill()
                        self.process.wait(timeout=1)
            except (OSError, ValueError):
                pass
            finally:
                # Also reap descendants after a cooperative or unexpected
                # worker exit. Closing only the root cannot do this on Windows.
                try:
                    self._terminate_owned_tree()
                finally:
                    self._fail()
                    self._reader.join(timeout=0.2)
                    if not self._reader.is_alive() and self.process.stdout:
                        self.process.stdout.close()


def _worker(root):
    command = runtime_command(root)
    if not command:
        raise BrowserError()
    return PipeWorker(command)


def _integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise BrowserError(400)
    return value


def _geometry(payload):
    # Match worker defaults/ranges. Node accepts finite fractional dimensions.
    for name, default, low, high in (('width', 900, 100, 2400),
                                    ('height', 650, 100, 1800),
                                    ('scale', 80, 40, 150)):
        value = payload.get(name, default)
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise BrowserError(400)


def _url(value):
    if not isinstance(value, str) or len(value) > 8192 or any(ord(c) < 32 for c in value):
        raise BrowserError(400)
    try:
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.hostname or parts.username is not None or parts.password is not None:
            raise BrowserError(400)
        parts.port
    except ValueError:
        raise BrowserError(400) from None
    return value


def _json_object(value):
    if not isinstance(value, dict):
        raise BrowserError(400)
    try:
        raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, RecursionError):
        raise BrowserError(400) from None
    if len(raw) > BODY_LIMIT:
        raise BrowserError(413)
    return value


def _result(result, *, allow_ack=False):
    """Whitelist worker output; no diagnostics/debug address/extra fields escape."""
    if allow_ack and isinstance(result, dict) and set(result) == {"ok"} and result["ok"] is True:
        return {"ok": True}
    if not isinstance(result, dict):
        raise BrowserError()
    try:
        view = _integer(result["view"], 0, 2**53 - 1)
        seq = _integer(result["seq"], 0, 2**53 - 1)
        width = _integer(result["width"], 1, 8192)
        height = _integer(result["height"], 1, 8192)
        origin = result["origin"]
        if origin:
            parts = urlsplit(_url(origin))
            origin = f"{parts.scheme}://{parts.netloc}"
        elif origin != "":
            raise BrowserError()
        status = result["status"]
        if status not in {"ready", "loading", "error", "closed", "opening", "blocked", "switching", "limited"}:
            raise BrowserError()
        frame = result.get("frame")
        if frame is not None:
            if (not isinstance(frame, dict) or frame.get("format") != "png"
                    or frame.get("view") != view or frame.get("seq") != seq
                    or not isinstance(frame.get("data"), str) or len(frame["data"]) > FRAME_LIMIT):
                raise BrowserError()
            raw = base64.b64decode(frame["data"], validate=True)
            if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
                raise BrowserError()
            frame = {"data": frame["data"], "seq": seq, "format": "png", "view": view}
        return dict(view=view, seq=seq, origin=origin, status=status, width=width,
                    height=height, rememberLogin=True, frame=frame)
    except Exception:
        raise BrowserError() from None


@dataclass
class _Session:
    id: str
    key: tuple
    root: Path
    worker: object = None
    timer: object = None
    last_seen: float = field(default_factory=time.monotonic)
    lock: object = field(default_factory=threading.Lock)
    closed: bool = False
    queue: list = field(default_factory=list)
    frame_waiter: object = None
    opened: bool = False
    closing: bool = False


@dataclass(eq=False)
class _Control:
    deadline: float
    cancel: object = field(default_factory=threading.Event)
    session: object = None


class BrowserService:
    def __init__(self, *, worker_factory=None, lease_seconds=45, operation_timeout=15,
                 max_pending=4, clock=time.monotonic):
        self.worker_factory = worker_factory or _worker
        self.lease_seconds = lease_seconds
        self.operation_timeout = operation_timeout
        self.max_pending = max_pending
        self.clock = clock
        self._lock = threading.RLock()
        self._sessions = {}
        self._scopes = {}

    def status(self, *, _control=None):
        self._check(_control or self.prepare('status', ()))
        # Resolve on every request, including status, without creating storage.
        data_dir(create=False)
        return {"available": runtime_command() is not None, "rememberLogin": True}

    def _home(self):
        return Path(data_dir()).resolve()

    def prepare(self, operation, args):
        """Reserve before executor submission, including executor/lock wait.

        Internal controls own a bounded FIFO slot until the thread finishes;
        positive frame waits instead reserve a single independent slot.
        """
        control = _Control(self.clock() + self.operation_timeout)
        if operation in {'frame', 'action', 'close', 'clear'}:
            session = self._get(args[0])
            with self._lock:
                if session.closed:
                    raise BrowserError(404)
                wait_ms = _integer(args[2], 0, FRAME_WAIT_MAX_MS) if operation == 'frame' and len(args) > 2 else 0
                if wait_ms:
                    if not session.opened or session.closing:
                        raise BrowserError(404)
                    if session.frame_waiter is not None:
                        raise BrowserError(409, code='busy', fatal=False)
                    # Leave transport slack for a large PNG, but never let a
                    # stalled frame RPC hold its slot for the control budget.
                    control.deadline = min(control.deadline, self.clock() + wait_ms / 1000 + 2)
                    control.session = session
                    session.frame_waiter = control
                    return control
                if len(session.queue) >= self.max_pending:
                    raise BrowserError(409, code='busy', fatal=False)
                control.session = session
                session.queue.append(control)
        return control

    def release(self, control):
        if control.session is not None:
            with self._lock:
                if control.session.frame_waiter is control:
                    control.session.frame_waiter = None
                if control in control.session.queue:
                    control.session.queue.remove(control)

    def _check(self, control):
        if control.cancel.is_set():
            raise BrowserError(409, code='cancelled', fatal=False)
        remaining = control.deadline - self.clock()
        if remaining <= 0:
            raise BrowserError(504, fatal=False)
        return remaining

    @contextmanager
    def _turn(self, id, operation, control):
        control = control or self.prepare(operation, (id,))
        session = control.session
        acquired = False
        try:
            if self._get(id) is not session:
                raise BrowserError(404)
            while True:
                remaining = self._check(control)
                with self._lock:
                    if session.closed:
                        raise BrowserError(404)
                    if session.queue and session.queue[0] is control:
                        acquired = session.lock.acquire(blocking=False)
                if acquired:
                    break
                control.cancel.wait(min(.01, remaining))
            self._check(control)
            yield session, control
        finally:
            if acquired:
                session.lock.release()
            self.release(control)

    def _request(self, session, op, payload, control):
        remaining = self._check(control)
        # Cancellation after this dispatch boundary cannot retract child work.
        # In-flight RPC still obeys its deadline and cannot renew a cancelled lease.
        if isinstance(session.worker, PipeWorker):
            return session.worker.request(op, payload, timeout=remaining)
        return session.worker.request(op, payload)

    def _get(self, id):
        home = self._home()
        with self._lock:
            session = self._sessions.get(id)
            if not session or session.closed or session.key[0] != home:
                raise BrowserError(404)
            return session

    def _touch(self, session):
        with self._lock:
            session.last_seen = self.clock()
            if session.timer:
                session.timer.cancel()
            if session.closed:
                return
            timer = threading.Timer(self.lease_seconds, self._expire, (session,))
            timer.daemon = True
            session.timer = timer
            timer.start()

    def _expire(self, session):
        if not session.lock.acquire(blocking=False):
            with self._lock:
                if not session.closed:
                    timer = threading.Timer(0.1, self._expire, (session,))
                    timer.daemon = True
                    session.timer = timer
                    timer.start()
            return
        try:
            if session.closed:
                return
            if self.clock() - session.last_seen < self.lease_seconds:
                self._touch(session)
                return
            self._dispose(session, graceful=True)
        finally:
            session.lock.release()

    def _worker_lost(self, session):
        with session.lock:
            self._dispose(session)

    def _dispose(self, session, *, graceful=False):
        with self._lock:
            if session.closed:
                return
            session.closed = True
            if session.timer:
                session.timer.cancel()
        try:
            if session.worker:
                if graceful:
                    try:
                        session.worker.request("close", {})
                    except Exception:
                        pass
                if isinstance(session.worker, PipeWorker):
                    # close/clear already got their ack, or this is fatal
                    # teardown. Do not spend a fresh RPC budget during disposal.
                    session.worker.stop(graceful=False)
                else:
                    session.worker.stop()
        finally:
            with self._lock:
                self._sessions.pop(session.id, None)
                if self._scopes.get(session.key) is session:
                    self._scopes.pop(session.key, None)

    def create(self, body, *, _control=None):
        control = _control or self.prepare('create', ())
        self._check(control)
        body = _json_object(body)
        if set(body) - {"scope", "url", "width", "height", "scale"}:
            raise BrowserError(400)
        scope = body.get("scope")
        if not isinstance(scope, str) or not 1 <= len(scope) <= 512 or any(ord(c) < 32 or ord(c) == 127 for c in scope):
            raise BrowserError(400)
        payload = dict(url=_url(body.get("url")), width=body.get("width", 1000),
                       height=body.get("height", 800))
        scale = body.get("scale", 80)
        if type(scale) not in (int, float) or not math.isfinite(scale) or not 40 <= scale <= 150:
            raise BrowserError(400)
        payload["scale"] = scale
        _geometry(payload)
        home = self._home()
        digest = hashlib.sha256(scope.encode("utf-8")).hexdigest()
        base = home / "browser"
        root = base / digest
        if base.resolve() != base or root.resolve() != root:
            raise BrowserError()
        key = (home, digest)
        with self._lock:
            if key in self._scopes:
                raise BrowserError(409)
            session = _Session(secrets.token_urlsafe(32), key, root)
            self._sessions[session.id] = self._scopes[key] = session
        with session.lock:
            try:
                self._check(control)
                root.mkdir(parents=True, exist_ok=True)
                # Check again after creation; never follow a supplied directory.
                if root.resolve() != root:
                    raise BrowserError()
                session.worker = self.worker_factory(root)
                if isinstance(session.worker, PipeWorker):
                    session.worker.set_exit_callback(lambda: self._worker_lost(session))
                result = _result(self._request(session, "open", payload, control))
                self._check(control)
                with self._lock:
                    session.opened = True
                self._touch(session)
                return {"id": session.id, **result}
            except BaseException as error:
                self._dispose(session)
                if isinstance(error, BrowserError):
                    raise
                raise BrowserError() from None

    def _call(self, id, op, payload, control=None):
        with self._turn(id, 'frame', control) as (session, control):
            try:
                result = _result(self._request(session, op, payload, control), allow_ack=op in ACTIONS)
                if not control.cancel.is_set() and self.clock() < control.deadline:
                    self._touch(session)
                return result
            except BaseException as error:
                if not isinstance(error, BrowserError) or error.fatal:
                    self._dispose(session)
                if isinstance(error, BrowserError):
                    raise
                raise BrowserError() from None

    def frame(self, id, after_seq=0, wait_ms=0, *, _control=None):
        try:
            payload = {'after_seq': _integer(after_seq, 0, 2**53 - 1)}
            wait_ms = _integer(wait_ms, 0, FRAME_WAIT_MAX_MS)
            if not wait_ms:
                return self._call(id, 'frame', payload, _control)
            _control = _control or self.prepare('frame', (id, after_seq, wait_ms))
            session = self._get(id)
            with self._lock:
                if session.frame_waiter is not _control or session.closed or session.closing:
                    raise BrowserError(404)
            try:
                result = _result(self._request(session, 'frame', {**payload, 'wait_ms': wait_ms}, _control))
                if not _control.cancel.is_set() and self.clock() < _control.deadline:
                    self._touch(session)
                return result
            except BaseException as error:
                if not isinstance(error, BrowserError) or error.fatal:
                    self._dispose(session)
                if isinstance(error, BrowserError):
                    raise
                raise BrowserError() from None
        finally:
            if _control:
                self.release(_control)

    def action(self, id, op, payload, *, _control=None):
        try:
            if not isinstance(op, str) or op not in ACTIONS:
                raise BrowserError(400)
            payload = _json_object(payload)
            if op == 'navigate':
                _url(payload.get('url'))
            if op == 'resize':
                if set(payload) - {'width', 'height', 'scale'}:
                    raise BrowserError(400)
                _geometry(payload)
            return self._call(id, op, payload, _control)
        finally:
            if _control:
                self.release(_control)

    def _finish(self, id, clear=False, control=None):
        with self._turn(id, 'clear' if clear else 'close', control) as (session, control):
            with self._lock:
                session.closing = True
            try:
                result = self._request(session, 'clear' if clear else 'close', {}, control)
                ack = 'cleared' if clear else 'closed'
                if not isinstance(result, dict) or set(result) != {ack} or result[ack] is not True:
                    raise BrowserError()
            except BaseException as error:
                if not isinstance(error, BrowserError) or error.fatal:
                    self._dispose(session)
                if isinstance(error, BrowserError):
                    raise
                raise BrowserError() from None
            else:
                self._dispose(session)
                return {ack: True}
            finally:
                with self._lock:
                    session.closing = False

    def close(self, id, *, _control=None):
        return self._finish(id, control=_control)

    def clear(self, id, confirm, *, _control=None):
        if confirm is not True:
            if _control:
                self.release(_control)
            raise BrowserError(400)
        return self._finish(id, clear=True, control=_control)

    def shutdown(self):
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            with session.lock:
                self._dispose(session, graceful=True)


browser_service = BrowserService()
atexit.register(browser_service.shutdown)
