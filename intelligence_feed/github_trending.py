"""GitHub Trending HTML adapter and period snapshots (not a stars-based ranking)."""
import re

from .models import SourceItem
from .parsers import clean_summary
from .repository import upsert_item


DOMAIN = "github-trending"
PERIOD_WORD = {"daily": "day", "weekly": "week", "monthly": "month"}
_ARTICLE = re.compile(r"<article\b(?P<attrs>[^>]*)>(?P<body>.*?)</article\s*>", re.I | re.S)
_REPO = re.compile(r"/[A-Za-z0-9-]+/(?!\.{1,2}$)[A-Za-z0-9_.-]+")
_NUMBER = r"(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)"


def _attribute(attrs, name):
    match = re.search(rf'''\s{re.escape(name)}\s*=\s*(["'])(.*?)\1''', attrs, re.I | re.S)
    return match[2] if match else ""


def parse_github_trending(data: bytes, source: dict) -> list[SourceItem]:
    period = source["id"].removeprefix(DOMAIN + "-")
    label = r"(?:today|this day)" if period == "daily" else f"this {PERIOD_WORD[period]}"
    items, seen = [], set()
    for article in _ARTICLE.finditer(data.decode("utf-8")):
        if "Box-row" not in _attribute(article["attrs"], "class").split():
            continue
        body = article["body"]
        h2 = re.search(r"<h2\b[^>]*>(.*?)</h2\s*>", body, re.I | re.S)
        anchor = re.search(r"<a\b([^>]*)>", h2[1], re.I | re.S) if h2 else None
        path = _attribute(anchor[1], "href") if anchor else ""
        if not _REPO.fullmatch(path) or path.lower() in seen:
            raise ValueError("Unexpected GitHub Trending repository row")
        seen.add(path.lower())
        description = re.search(r"<p\b[^>]*>(.*?)</p\s*>", body, re.I | re.S)
        language, stars, gained = "", None, None
        for match in re.finditer(r"<a\b([^>]*)>(.*?)</a\s*>", body, re.I | re.S):
            if _attribute(match[1], "href").lower() == path.lower() + "/stargazers":
                stars = clean_summary(match[2])
                break
        for match in re.finditer(r"<span\b([^>]*)>", body, re.I | re.S):
            attrs = match[1]
            if _attribute(attrs, "itemprop") == "programmingLanguage":
                language = clean_summary(body[match.end():].partition("</span>")[0], 60)
            if "float-sm-right" in _attribute(attrs, "class").split():
                gained = clean_summary(body[match.end():].partition("</span>")[0])
        number = re.fullmatch(_NUMBER, stars or "")
        delta = re.fullmatch(rf"({_NUMBER}) stars? {label}", gained or "", re.I)
        if not number or not delta:
            raise ValueError("Unrecognized GitHub Trending star counts or period")
        items.append(SourceItem(source["id"], DOMAIN, "GitHub Trending", "https://github.com" + path.lower(),
                                path[1:], clean_summary(description[1]) if description else "", None,
                                trending=(language, int(number[0].replace(",", "")), int(delta[1].replace(",", "")))))
    if not items:
        raise ValueError("GitHub Trending returned no recognizable repositories")
    return items


def replace_snapshot(conn, source_id, items):
    """Replace one period in the caller's transaction; preserve shared event IDs."""
    if not items:
        raise ValueError("GitHub Trending snapshot is empty")
    conn.execute("DELETE FROM github_trending_ranks WHERE source_id=?", (source_id,))
    inserted = 0
    for rank, item in enumerate(items, 1):
        event_id, created = upsert_item(conn, item)
        inserted += int(created)
        conn.execute("""INSERT INTO github_trending_ranks
                     (source_id, rank, event_id, summary, language, stars, period_stars) VALUES(?,?,?,?,?,?,?)""",
                     (source_id, rank, event_id, item.summary, *item.trending))
    return inserted


def list_snapshot(conn, profile, period):
    source_id = f"{DOMAIN}-{period}"
    # Read rows, source timestamp and attempt status in the same snapshot.
    with conn:
        conn.execute("BEGIN")
        source = conn.execute("SELECT enabled,last_success_at FROM sources WHERE id=?", (source_id,)).fetchone()
        if source is None or not source["enabled"]:
            return {"items": [], "next_cursor": None, "updated_at": None,
                    "status": "disabled" if source else "pending"}
        attempt = conn.execute("SELECT status FROM source_runs WHERE source_id=? ORDER BY id DESC LIMIT 1",
                               (source_id,)).fetchone()
        rows = conn.execute("""SELECT e.id, e.headline, a.canonical_url AS url, r.rank, r.summary,
                              r.language, r.stars, r.period_stars, us.read_at IS NOT NULL AS read,
                              us.favorite_at IS NOT NULL AS favorite
                              FROM github_trending_ranks r JOIN events e ON e.id=r.event_id
                              JOIN articles a ON a.id=e.primary_article_id
                              LEFT JOIN user_state us ON us.event_id=e.id AND us.profile=?
                              WHERE r.source_id=? ORDER BY r.rank""", (profile, source_id)).fetchall()
        items = [dict(row, read=bool(row["read"]), favorite=bool(row["favorite"])) for row in rows]
        return {"items": items, "next_cursor": None, "updated_at": source["last_success_at"],
                "status": attempt["status"] if attempt else "pending"}
