#!/usr/bin/env python3
"""
Settings persistence endpoint for Alexandria Cover Designer v2.

GET  /cgi-bin/settings.py          -> returns all saved settings as JSON
POST /cgi-bin/settings.py          -> merges posted settings into stored file
POST /cgi-bin/settings.py/reset    -> deletes stored settings, returns empty object

Settings are stored as a flat JSON file on disk so they persist across
page reloads, deployments, and browser sessions.
"""

import json
import os
import sys
from pathlib import Path

SETTINGS_FILE = Path("settings_store.json")


def load_settings():
    """Load settings from disk, or return empty dict."""
    if SETTINGS_FILE.exists():
        try:
            return json.loads(SETTINGS_FILE.read_text())
        except Exception:
            return {}
    return {}


def save_settings(data):
    """Write settings dict to disk."""
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))


def respond(status, body, content_type="application/json"):
    print(f"Status: {status}")
    print(f"Content-Type: {content_type}")
    print("Access-Control-Allow-Origin: *")
    print("Access-Control-Allow-Methods: GET, POST, OPTIONS")
    print("Access-Control-Allow-Headers: Content-Type")
    print()
    if isinstance(body, (dict, list)):
        print(json.dumps(body))
    else:
        print(body)


def main():
    method = os.environ.get("REQUEST_METHOD", "GET")
    path_info = os.environ.get("PATH_INFO", "")

    # CORS preflight
    if method == "OPTIONS":
        respond(200, {})
        return

    # POST /reset -- clear stored settings
    if method == "POST" and path_info == "/reset":
        if SETTINGS_FILE.exists():
            SETTINGS_FILE.unlink()
        respond(200, {"status": "reset"})
        return

    # POST / -- merge incoming settings
    if method == "POST":
        try:
            content_length = int(os.environ.get("CONTENT_LENGTH", 0))
            raw = sys.stdin.read(content_length) if content_length else sys.stdin.read()
            incoming = json.loads(raw) if raw.strip() else {}
        except Exception as e:
            respond(400, {"error": f"Invalid JSON: {e}"})
            return

        current = load_settings()
        current.update(incoming)
        save_settings(current)
        respond(200, current)
        return

    # GET / -- return all settings
    respond(200, load_settings())


if __name__ == "__main__":
    main()
