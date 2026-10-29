"""Import a shared legacy database into the active Hermes profile (dry-run default)."""
import argparse
import json
from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from intelligence_feed.migration import migrate_legacy_database


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Legacy intelligence.db to import")
    parser.add_argument("--apply", action="store_true", help="Perform the import (otherwise only show the plan)")
    args = parser.parse_args(argv)
    try:
        result = migrate_legacy_database(args.source, apply=args.apply)
    except FileExistsError:
        print("Profile database already exists; nothing was overwritten.", file=sys.stderr)
        return 1
    except Exception:
        print("Database migration failed; the source was not removed.", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
