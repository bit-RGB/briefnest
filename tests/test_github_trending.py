import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dashboard.plugin_api import router
from intelligence_feed import collector, repository, sources
from intelligence_feed.models import FetchResponse


def row(name, stars, gained, period="month"):
    return f'''<article class="Box-row">
      <a href="/login?return_to=ignored">Star</a>
      <h2><a href="/{name}">{name}</a></h2>
      <p>Tools &amp; <i>examples</i></p><span itemprop="programmingLanguage">Python</span>
      <a href="/{name}/stargazers"><svg></svg>{stars}</a>
      <span class="d-inline-block float-sm-right"><svg></svg>{gained} stars this {period}</span>
    </article>'''


def test_snapshots_keep_official_order_and_favorites_when_one_period_fails(conn, monkeypatch):
    pages = {
        "daily": row("owner/zed", "2,000", "14", "day"),
        "weekly": row("owner/alpha", "900", "88", "week"),
        "monthly": row("owner/alpha", "900", "111") + row("owner/zed", "2,000", "950"),
    }
    manifest = [s for s in sources.load_sources() if s["id"].startswith("github-trending-")]
    assert len(manifest) == 3

    def fetch(url, **_):
        return FetchResponse(200, pages[url.rsplit("=", 1)[1]].encode())

    monkeypatch.setattr(sources, "fetch_url", fetch)
    assert collector.run_update(source_loader=lambda: manifest).error_count == 0
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        def board(period=None, profile="default"):
            params = {"profile": profile}
            if period:
                params["period"] = period
            result = client.get("/github-trending", params=params)
            assert result.status_code == 200
            return result.json()

        monthly = board()
        assert monthly["status"] == "success"
        assert monthly["updated_at"]
        assert [(r["rank"], r["headline"], r["stars"], r["period_stars"]) for r in monthly["items"]] == [
            (1, "owner/alpha", 900, 111), (2, "owner/zed", 2000, 950),
        ]
        alpha = monthly["items"][0]
        assert alpha["summary"] == "Tools & examples"
        assert alpha["language"] == "Python"
        assert board("weekly")["items"][0]["id"] == alpha["id"]
        assert not repository.list_events(conn, "default", "all", "all", "", 50, None)["items"]
        assert repository.counts(conn, "default")["all"]["total"] == 0
        assert client.patch(f'/events/{alpha["id"]}/favorite', json={"value": True, "profile": "default"}).status_code == 200
        assert board("weekly")["items"][0]["favorite"] is True
        assert board("weekly", "other")["items"][0]["favorite"] is False
        pages["monthly"] = "<html>Unexpected response</html>"
        pages["weekly"] = row("owner/zed", "2,001", "100", "week")
        assert collector.run_update(source_loader=lambda: manifest).error_count == 1
        retained = board()
        assert retained["status"] == "failed"
        assert retained["updated_at"] == monthly["updated_at"]
        assert [r["headline"] for r in retained["items"]] == ["owner/alpha", "owner/zed"]
        assert [r["headline"] for r in board("weekly")["items"]] == ["owner/zed"]
        favorites = repository.list_events(conn, "default", "favorites", "all", "", 50, None)
        assert favorites["items"][0]["url"] == "https://github.com/owner/alpha"
        assert client.get('/github-trending?profile=default&period=yearly').status_code == 422


@pytest.mark.parametrize("bad", ["<article class='Box-row'><h2><a href='//evil.test/repo'>fake</a></h2></article>",
                                row("owner/alpha", "99", "8", "week"),
                                row("owner/alpha", "99", "8") * 2])
def test_unrecognized_or_inconsistent_html_is_not_a_success(monkeypatch, bad):
    source = next(s for s in sources.load_sources() if s["id"] == "github-trending-monthly")
    monkeypatch.setattr(sources, "fetch_url", lambda *a, **k: FetchResponse(200, bad.encode()))
    with pytest.raises(ValueError, match="Trending"):
        sources.fetch_source(source)
