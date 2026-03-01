#!/usr/bin/env python3
"""
Catalog cache endpoint for Alexandria Cover Designer v2.

GET  /cgi-bin/catalog.py          → returns cached catalog JSON (instant)
POST /cgi-bin/catalog.py/refresh  → triggers a full re-sync from Drive, returns new catalog
GET  /cgi-bin/catalog.py/status   → returns cache age and book count

The catalog is stored as a JSON file on disk so it persists across requests.
On first request, if no cache exists, it triggers a sync automatically.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
API_KEY = "AIzaSyAY6XvPxrdS_fMNMZEUkJd7UW9b9yuJDgI"
SOURCE_FOLDER = "1ybFYDJk7Y3VlbsEjRAh1LOfdyVsHM_cS"
CACHE_FILE = Path("catalog_cache.json")
CACHE_MAX_AGE_SECONDS = 3600  # 1 hour — background refresh if older

# ---------------------------------------------------------------------------
# Drive API helpers
# ---------------------------------------------------------------------------

def drive_list_subfolders(folder_id):
    """List ALL subfolders (paginated) in a Drive folder."""
    all_folders = []
    page_token = None
    while True:
        q = f"'{folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
        url = (
            f"https://www.googleapis.com/drive/v3/files"
            f"?q={urllib.parse.quote(q)}"
            f"&fields=nextPageToken,files(id,name)"
            f"&pageSize=1000"
            f"&key={API_KEY}"
        )
        if page_token:
            url += f"&pageToken={urllib.parse.quote(page_token)}"

        with urllib.request.urlopen(url) as resp:
            data = json.loads(resp.read())

        all_folders.extend(data.get("files", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return all_folders


def drive_list_files(folder_id):
    """List files in a single Drive folder."""
    q = f"'{folder_id}' in parents and trashed=false"
    url = (
        f"https://www.googleapis.com/drive/v3/files"
        f"?q={urllib.parse.quote(q)}"
        f"&fields=files(id,name,mimeType)"
        f"&pageSize=100"
        f"&key={API_KEY}"
    )
    with urllib.request.urlopen(url) as resp:
        data = json.loads(resp.read())
    return data.get("files", [])


def parse_folder_name(name):
    """Parse '142. The Carnivore — Katherine MacLean' into parts."""
    m = re.match(r'^(\d+)\.\s+(.+?)\s+[—–]\s+(.+?)(?:\s+copy)?$', name, re.I)
    if m:
        return {"number": m.group(1), "title": m.group(2).strip(), "author": m.group(3).strip()}
    m2 = re.match(r'^(\d+)\.\s+(.+)', name)
    number = m2.group(1) if m2 else ""
    title = m2.group(2).strip() if m2 else name
    m3 = re.match(r'^(.+?)\s+[—–]\s+(.+)$', title)
    if m3:
        title = m3.group(1).strip()
        author = m3.group(2).strip()
    else:
        author = ""
    return {"number": number, "title": title, "author": author}


def sync_catalog():
    """Full sync: list subfolders, find cover JPGs, return book list."""
    folders = drive_list_subfolders(SOURCE_FOLDER)
    books = []

    for folder in folders:
        parsed = parse_folder_name(folder["name"])
        cover_id = None
        cover_name = None
        try:
            files = drive_list_files(folder["id"])
            for f in files:
                if f.get("mimeType") == "image/jpeg" or f["name"].lower().endswith((".jpg", ".jpeg")):
                    cover_id = f["id"]
                    cover_name = f["name"]
                    break
        except Exception:
            pass

        books.append({
            "id": folder["id"],
            "number": parsed["number"],
            "title": parsed["title"],
            "author": parsed["author"],
            "folder_name": folder["name"],
            "cover_jpg_id": cover_id,
            "cover_file_name": cover_name,
            "genre": "",
            "themes": "",
            "era": "",
            "synced_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })

    catalog = {
        "books": books,
        "synced_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(books),
    }

    CACHE_FILE.write_text(json.dumps(catalog))
    return catalog


def load_cache():
    """Load the cached catalog, or None if not present."""
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text())
        except Exception:
            return None
    return None


def cache_age_seconds():
    """How old the cache file is, in seconds."""
    if not CACHE_FILE.exists():
        return float("inf")
    return time.time() - CACHE_FILE.stat().st_mtime


# ---------------------------------------------------------------------------
# CGI request handler
# ---------------------------------------------------------------------------

def respond(status, body, content_type="application/json"):
    print(f"Status: {status}")
    print(f"Content-Type: {content_type}")
    print("Access-Control-Allow-Origin: *")
    print()
    if isinstance(body, dict) or isinstance(body, list):
        print(json.dumps(body))
    else:
        print(body)


def main():
    method = os.environ.get("REQUEST_METHOD", "GET")
    path_info = os.environ.get("PATH_INFO", "")

    # POST /refresh — force re-sync
    if method == "POST" and path_info == "/refresh":
        try:
            catalog = sync_catalog()
            respond(200, catalog)
        except Exception as e:
            respond(500, {"error": str(e)})
        return

    # GET /status — cache info
    if path_info == "/status":
        age = cache_age_seconds()
        cache = load_cache()
        respond(200, {
            "cached": cache is not None,
            "age_seconds": round(age, 1) if age != float("inf") else None,
            "count": cache["count"] if cache else 0,
            "synced_at": cache["synced_at"] if cache else None,
            "stale": age > CACHE_MAX_AGE_SECONDS,
        })
        return

    # GET / — return cached catalog (sync if no cache yet)
    cache = load_cache()
    if cache is None:
        # First ever request — must sync
        try:
            cache = sync_catalog()
        except Exception as e:
            respond(500, {"error": f"Initial sync failed: {e}"})
            return

    respond(200, cache)


if __name__ == "__main__":
    main()
