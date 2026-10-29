# intelligence_feed/paths.py
from pathlib import Path
from hermes_constants import get_hermes_home


def data_dir(*, create: bool = True) -> Path:
    # Resolve on every operation: one Hermes process can serve multiple profiles.
    # A process-global environment override would break this isolation.
    root = get_hermes_home() / "plugin-data" / "intelligence-feed"
    if create:
        root.mkdir(parents=True, exist_ok=True)
    return root


def database_path() -> Path:
    return data_dir() / "intelligence.db"
