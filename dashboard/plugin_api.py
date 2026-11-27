"""Unprefixed Hermes REST router with a request-independent error boundary."""
import asyncio
import logging
import re
import sys
import threading
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field, StrictBool

# Hermes loads dashboard APIs directly from their file path rather than as a
# package. Add this plugin's root so its private Python package is importable
# without relying on the Desktop process working directory.
_PLUGIN_ROOT = Path(__file__).resolve().parents[1]
if str(_PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_ROOT))

from intelligence_feed import service

logger = logging.getLogger(__name__)


class SafeRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def safe_handler(request):
            try:
                return await handler(request)
            except RequestValidationError:
                # FastAPI's default errors echo inputs (including malformed JSON).
                raise HTTPException(422, "Invalid request") from None
            except HTTPException:
                raise
            except ValueError:
                raise HTTPException(400, "Invalid request") from None
            except KeyError:
                raise HTTPException(404, "Not found") from None
            except Exception:
                # Never attach the request, exception, traceback, or dynamic fields.
                logger.error("Intelligence feed API operation failed")
                raise HTTPException(500, "Internal server error") from None

        return safe_handler


router = APIRouter(route_class=SafeRoute)
_update_lock = threading.Lock()
# Retain shielded workers until completion if a request is cancelled.
_updates = set()
_PROFILE = r"^[A-Za-z0-9_-]{1,64}$"
Profile = Annotated[str, Query(pattern=_PROFILE, min_length=1, max_length=64)]
_CREDENTIAL_PATH = re.compile(
    r"(?:api[_-]?key|access[_-]?token|token|secret)[=:_-]",
    re.IGNORECASE,
)


class StateBody(BaseModel):
    profile: str = Field(pattern=_PROFILE, min_length=1, max_length=64)
    value: StrictBool


class SourceStateBody(BaseModel):
    value: StrictBool


@router.get("/events")
def events(
    profile: Profile,
    domain: Literal["all", "semiconductor", "ai", "automotive", "music", "weibo", "favorites"] = "all",
    read: Literal["all", "unread", "read"] = "all",
    q: Annotated[str, Query(max_length=100)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: str | None = None,
):
    page = service.list_events(profile=profile, domain=domain, read=read,
                               q=q, limit=limit, cursor=cursor)
    credentials = service.configured_credentials()
    items = []
    for item in page["items"]:
        item = dict(item)
        # Preserve the page shape without publishing URL credentials. Query
        # strings are kept (e.g. Weibo search URLs carry the topic in ?q=);
        # any URL containing a configured credential value is still blanked
        # by the `valid` check above.
        parts = urlsplit(item["url"])
        valid = (
            parts.scheme == "https"
            and bool(parts.hostname)
            and parts.username is None
            and parts.password is None
            and not _CREDENTIAL_PATH.search(parts.path)
            and not any(secret in item["url"] for secret in credentials)
        )
        item["url"] = (
            urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
            if valid else ""
        )
        items.append(item)
    return {"items": items, "next_cursor": page["next_cursor"]}


@router.get("/counts")
def counts(profile: Profile):
    return service.counts(profile)


@router.get("/github-trending")
def github_trending(profile: Profile, period: Literal["daily", "weekly", "monthly"] = "monthly"):
    return service.list_github_trending(profile, period)


@router.get("/sources")
def source_settings():
    return service.list_sources()


@router.patch("/sources/{id}")
def set_source(id: str, body: SourceStateBody):
    return service.set_source_enabled(id, body.value)


@router.get("/runs/latest")
def latest_run():
    return service.latest_run()


@router.patch("/events/{id}/read")
def set_read(id: int, body: StateBody):
    return service.set_read(body.profile, id, body.value)


@router.patch("/events/{id}/favorite")
def set_favorite(id: int, body: StateBody):
    return service.set_favorite(body.profile, id, body.value)


def _collect(started):
    started.set()
    try:
        return service.run_update().to_dict()
    finally:
        # The worker owns release: cancelling an HTTP request cannot release
        # the lock while its collection thread is still writing to the database.
        _update_lock.release()


async def _dispatch():
    started = threading.Event()
    try:
        return await asyncio.to_thread(_collect, started)
    except BaseException:
        # Executor submission can fail before the worker owns the lock.
        if not started.is_set():
            _update_lock.release()
        raise


def _finished(task):
    _updates.discard(task)
    if not task.cancelled():
        error = task.exception()  # Consume failures even when the awaiting request left.
        if error is not None:
            logger.error("Detached intelligence feed update failed")


@router.post("/updates")
async def updates():
    if not _update_lock.acquire(blocking=False):
        raise HTTPException(409, "Update already in progress")
    try:
        task = asyncio.create_task(_dispatch())
    except BaseException:
        _update_lock.release()
        raise
    _updates.add(task)
    task.add_done_callback(_finished)
    return await asyncio.shield(task)


# Persistent preview is a private child process behind the same public REST
# router/error boundary. Never let FastAPI pre-buffer these JSON request bodies.
import json
from fastapi import Request
from intelligence_feed.browser_service import BrowserError, BODY_LIMIT, browser_service


async def _browser_body(request: Request):
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > BODY_LIMIT:
            raise HTTPException(413, "Request too large")
        raw.extend(chunk)
    try:
        def invalid_constant(_value):
            raise ValueError()
        body = json.loads(raw, parse_constant=invalid_constant)
        if not isinstance(body, dict):
            raise ValueError()
        return body
    except (ValueError, UnicodeError, RecursionError):
        raise HTTPException(400, "Invalid request") from None


def _browser_finished(task, manager, control):
    manager.release(control)
    if not task.cancelled():
        task.exception()  # Consume detached failures without logging child data.


async def _browser_call(operation, *args, request=None):
    manager = operation.__self__
    control = None
    task = watcher = None
    try:
        # Admission runs before to_thread, so overload never queues unlimited
        # executor jobs. to_thread retains the current profile ContextVars.
        control = manager.prepare(operation.__name__, args)
        task = asyncio.create_task(asyncio.to_thread(operation, *args, _control=control))
        task.add_done_callback(lambda done: _browser_finished(done, manager, control))
        if request is not None:
            async def disconnected():
                while not await request.is_disconnected():
                    await asyncio.sleep(.025)
                control.cancel.set()
            watcher = asyncio.create_task(disconnected())
        pending = (task, watcher) if watcher is not None else (task,)
        done, _ = await asyncio.wait(pending, timeout=max(0, control.deadline - manager.clock()),
                                     return_when=asyncio.FIRST_COMPLETED)
        if not done:
            # Leave already-dispatched RPC to finish/tear down within its own
            # remaining budget. A queued executor job may never send later.
            control.cancel.set()
            raise BrowserError(504, fatal=False)
        if watcher is not None and watcher in done:
            raise asyncio.CancelledError()
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        if control is not None:
            control.cancel.set()
        raise
    except BrowserError as error:
        raise HTTPException(error.status, error.detail,
                            headers={'X-Browser-Error': error.code}) from None
    finally:
        if watcher is not None:
            watcher.cancel()
        if control is not None and task is None:
            manager.release(control)


@router.get("/browser/status")
async def browser_status(request: Request = None):
    return await _browser_call(browser_service.status, request=request)


@router.post("/browser/sessions")
async def browser_create(request: Request):
    return await _browser_call(browser_service.create, await _browser_body(request), request=request)


@router.get("/browser/sessions/{id}/frame")
async def browser_frame(id: str, after_seq: Annotated[int, Query(ge=0, le=9007199254740991)] = 0,
                        request: Request = None, *, wait_ms: Annotated[int, Query(ge=0, le=1000)] = 0):
    # Query values travel as text; reject coercions such as "1.0" and duplicates.
    if request is not None:
        waits = request.query_params.getlist('wait_ms')
        if waits and (len(waits) != 1 or not waits[0].isascii() or not waits[0].isdigit()):
            raise HTTPException(400, "Invalid request")
    return await _browser_call(browser_service.frame, id, after_seq, wait_ms, request=request)


@router.post("/browser/sessions/{id}/action")
async def browser_action(id: str, request: Request):
    body = await _browser_body(request)
    if set(body) != {"op", "payload"}:
        raise HTTPException(400, "Invalid request")
    return await _browser_call(browser_service.action, id, body["op"], body["payload"], request=request)


@router.delete("/browser/sessions/{id}")
async def browser_close(id: str, request: Request = None):
    return await _browser_call(browser_service.close, id, request=request)


@router.post("/browser/sessions/{id}/clear")
async def browser_clear(id: str, request: Request):
    body = await _browser_body(request)
    if set(body) != {"confirm"} or body["confirm"] is not True:
        raise HTTPException(400, "Invalid request")
    return await _browser_call(browser_service.clear, id, True, request=request)
