"""DownMe Milestone M4 Full-Stack Integration Verification Suite.

Tests FastAPI unified serving, static assets, Content-Type headers,
SPA fallback, security barriers, and API endpoint integration.
"""

from __future__ import annotations

import io
import json
import zipfile
from fastapi.testclient import TestClient

from server.main import app

client = TestClient(app)


def test_root_and_index_html():
    """Verify / and /index.html serve src/index.html with UTF-8 HTML header."""
    for path in ["/", "/index.html"]:
        resp = client.get(path)
        assert resp.status_code == 200, f"Failed for {path}"
        assert "text/html" in resp.headers.get("content-type", "")
        content = resp.text

        # 1. Title & Meta
        assert "downhere" in content
        assert "apple-mobile-web-app-capable" in content

        # 2. Font Preloads
        assert "/fonts/thmanyahsans-Regular.otf" in content
        assert "/fonts/thmanyahsans-Bold.otf" in content
        assert "/fonts/thmanyahsans-Medium.otf" in content

        # 3. All 8 Required ES Modules Loaded
        required_scripts = [
            "/js/api.js",
            "/js/preview.js",
            "/js/trimmer.js",
            "/js/dragdrop.js",
            "/js/share-target.js",
            "/js/clipboard.js",
            "/js/app.js",
        ]
        for script in required_scripts:
            assert f'src="{script}"' in content, f"Missing script tag for {script}"

        # 4. Service Worker Registration
        assert "navigator.serviceWorker.register('/sw.js'" in content

        # 5. Core DOM IDs
        required_ids = [
            "url-input",
            "extract-btn",
            "clipboard-banner",
            "clipboard-download-btn",
            "drag-drop-overlay",
            "media-preview-card",
            "trimmer-container",
            "album-gallery-container",
        ]
        for dom_id in required_ids:
            assert f'id="{dom_id}"' in content, f"Missing DOM element id '{dom_id}'"


def test_manifest_webmanifest():
    """Verify /manifest.webmanifest serves with application/manifest+json and valid schema."""
    resp = client.get("/manifest.webmanifest")
    assert resp.status_code == 200
    assert "application/manifest+json" in resp.headers.get("content-type", "")

    manifest = resp.json()
    assert manifest.get("name") == "downhere — Media Downloader"
    assert manifest.get("display") == "standalone"
    assert "share_target" in manifest
    assert manifest["share_target"]["action"] == "/"
    assert manifest["share_target"]["params"]["url"] == "url"
    assert len(manifest.get("icons", [])) >= 4


def test_service_worker():
    """Verify /sw.js serves application/javascript with Service-Worker-Allowed: /."""
    resp = client.get("/sw.js")
    assert resp.status_code == 200
    assert "application/javascript" in resp.headers.get("content-type", "")
    assert resp.headers.get("service-worker-allowed") == "/"

    sw_text = resp.text
    assert "CACHE_NAME" in sw_text
    assert "/fonts/thmanyahsans-Regular.otf" in sw_text
    assert "/offline.html" in sw_text


def test_offline_fallback_html():
    """Verify /offline.html serves valid HTML with auto-reconnect listeners."""
    resp = client.get("/offline.html")
    assert resp.status_code == 200
    assert "text/html" in resp.headers.get("content-type", "")
    content = resp.text
    assert "Offline" in content
    assert "thmanyahsans" in content
    assert "addEventListener('online'" in content


def test_thmanyah_fonts_mime_types():
    """Verify all 5 local Thmanyah font weights serve with font/otf."""
    weights = ["Light", "Regular", "Medium", "Bold", "Black"]
    for weight in weights:
        path = f"/fonts/thmanyahsans-{weight}.otf"
        resp = client.get(path)
        assert resp.status_code == 200, f"Font missing: {path}"
        assert resp.headers.get("content-type") == "font/otf", f"Incorrect MIME for {path}"
        assert len(resp.content) > 200000, f"Font file abnormally small: {path}"


def test_css_stylesheets():
    """Verify all 3 CSS stylesheets serve with text/css."""
    sheets = ["apple-theme.css", "thmanyah-typography.css", "components.css"]
    for sheet in sheets:
        path = f"/css/{sheet}"
        resp = client.get(path)
        assert resp.status_code == 200, f"CSS missing: {path}"
        assert "text/css" in resp.headers.get("content-type", "")


def test_js_modules():
    """Verify all JavaScript modules serve with application/javascript."""
    modules = [
        "app.js",
        "api.js",
        "preview.js",
        "trimmer.js",
        "dragdrop.js",
        "health.js",
        "clipboard.js",
        "share-target.js",
    ]
    for mod in modules:
        path = f"/js/{mod}"
        resp = client.get(path)
        assert resp.status_code == 200, f"JS missing: {path}"
        assert "application/javascript" in resp.headers.get("content-type", "")


def test_icons_and_apple_shortcut():
    """Verify PWA icons, favicon, and iOS Apple Shortcut definition."""
    assert client.get("/icons/icon-192x192.png").headers.get("content-type") == "image/png"
    assert client.get("/icons/icon-512x512.png").headers.get("content-type") == "image/png"
    assert "image/svg+xml" in client.get("/icons/favicon.svg").headers.get("content-type", "")

    sc_resp = client.get("/shortcuts/DownMe.shortcut")
    assert sc_resp.status_code == 200
    assert sc_resp.headers.get("content-type") == "application/octet-stream"
    assert b"WFWorkflowActions" in sc_resp.content


def test_spa_client_side_routing_fallback():
    """Verify arbitrary client SPA routes fallback to src/index.html with 200 OK."""
    spa_routes = ["/watch", "/feed", "/pwa/install", "/shared-link"]
    for route in spa_routes:
        resp = client.get(route)
        assert resp.status_code == 200
        assert "text/html" in resp.headers.get("content-type", "")
        assert "downhere" in resp.text


def test_api_404_isolation():
    """Verify unknown API routes return structured 404 JSON, NOT HTML."""
    resp = client.get("/api/unknown_endpoint")
    assert resp.status_code == 404
    assert resp.headers.get("content-type") == "application/json"
    assert resp.json() == {"detail": "API route not found"}


def test_api_health():
    """Verify /api/health returns operational status and 4 platform probes."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.headers.get("content-type") == "application/json"
    data = resp.json()
    assert data["status"] in ("healthy", "operational")
    assert "platforms" in data
    for platform in ["youtube", "facebook", "tiktok", "pinterest"]:
        assert platform in data["platforms"]
        assert data["platforms"][platform]["status"] in ("operational", "degraded", "healthy")


def test_api_system_update():
    """Verify /api/system/update endpoint returns valid yt-dlp status."""
    resp = client.post("/api/system/update")
    assert resp.status_code == 200
    assert resp.headers.get("content-type") == "application/json"
    data = resp.json()
    assert data.get("success") is True
    assert "currentVersion" in data


def test_api_extract_validation():
    """Verify /api/extract validates input and rejects invalid URLs with 400."""
    empty_resp = client.post("/api/extract", json={"url": "   "})
    assert empty_resp.status_code == 400

    unsupported_resp = client.post("/api/extract", json={"url": "https://example.com/not-media"})
    assert unsupported_resp.status_code == 400


def test_api_download_thumbnail():
    """Verify /api/download retrieves thumbnails with valid image/jpeg headers."""
    yt_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    resp = client.get("/api/download", params={
        "url": yt_url,
        "formatId": "thumbnail",
        "mediaType": "thumbnail"
    })
    assert resp.status_code == 200
    assert resp.headers.get("content-type") == "image/jpeg"
    assert "Content-Disposition" in resp.headers
    assert resp.content[:2] == b"\xff\xd8"  # JPEG Magic Bytes


def test_api_download_zip():
    """Verify /api/download/zip streams a valid in-memory zip archive."""
    payload = {
        "albumTitle": "Test_Album",
        "items": [
            {"index": 1, "url": "https://httpbin.org/image/jpeg", "filename": "test1.jpg"},
            {"index": 2, "url": "https://httpbin.org/image/png", "filename": "test2.png"}
        ]
    }
    resp = client.post("/api/download/zip", json=payload)
    assert resp.status_code == 200
    assert resp.headers.get("content-type") == "application/zip"
    assert 'filename="Test_Album.zip"' in resp.headers.get("Content-Disposition", "")

    # Validate ZIP integrity
    zip_buffer = io.BytesIO(resp.content)
    with zipfile.ZipFile(zip_buffer, "r") as zf:
        namelist = zf.namelist()
        assert "test1.jpg" in namelist
        assert "test2.png" in namelist


if __name__ == "__main__":
    import sys
    import inspect

    current_module = sys.modules[__name__]
    test_functions = [
        obj for name, obj in inspect.getmembers(current_module)
        if inspect.isfunction(obj) and name.startswith("test_")
    ]

    print("=" * 65)
    print("  DownMe Milestone M4 Full-Stack Verification Suite")
    print(f"  Discovered {len(test_functions)} Integration Tests")
    print("=" * 65)

    passed = 0
    failed = 0
    for test_fn in test_functions:
        doc = (test_fn.__doc__ or "").strip().splitlines()[0]
        try:
            test_fn()
            print(f"  [PASS] {test_fn.__name__} - {doc}")
            passed += 1
        except Exception as exc:
            print(f"  [FAIL] {test_fn.__name__} - {doc}")
            print(f"         Error: {exc}")
            failed += 1

    print("=" * 65)
    print(f"  Result: {passed} passed, {failed} failed.")
    print("=" * 65)
    sys.exit(0 if failed == 0 else 1)
