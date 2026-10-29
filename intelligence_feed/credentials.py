"""Profile-scoped source credentials and shared diagnostic redaction.

Hermes owns resolution/fallback policy. Never cache keys or read the process
credential environment here: a single host can serve multiple profiles.
"""
import re
from urllib.parse import quote, quote_plus


def source_key(source):
    name = source.get("api_key_env")
    if not name:
        return ""
    # Resolve at call time so the host's current context (and rotations) wins.
    from agent import secret_scope
    return (secret_scope.get_secret(name) or "").strip()


def credential_variants(value):
    if not value:
        return set()
    return {value, quote(value, safe=""), quote_plus(value, safe="")}


def configured_credentials(manifest):
    values = set()
    for source in manifest:
        values.update(credential_variants(source_key(source)))
    return values


def sanitize(message, credentials):
    message = str(message)
    # Strip URL query/fragment first: replacing a key such as 'https' first
    # would make its URL unrecognizable. Include relative URLs.
    message = re.sub(r"(?<!\S)([^\s?#]+)[?#][^\s]*", r"\1", message)
    for value in sorted(credentials, key=len, reverse=True):
        message = re.sub(re.escape(value), "[REDACTED]", message, flags=re.IGNORECASE)
    return " ".join(message.split())[:500]
