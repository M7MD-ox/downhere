"""Test live DownMe server on http://127.0.0.1:3000."""

import socket
import subprocess
import sys
import time
import httpx

def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

def test_live_server():
    port = 3000
    # Try port 3000 or fallback if busy
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('127.0.0.1', port))
    except OSError:
        port = find_free_port()

    print(f"Starting test server on port {port}...")
    proc = subprocess.Popen(
        ["uv", "run", "uvicorn", "server.main:app", "--host", "127.0.0.1", "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    base_url = f"http://127.0.0.1:{port}"
    try:
        # Wait up to 10 seconds for server to boot
        ready = False
        for _ in range(20):
            try:
                res = httpx.get(f"{base_url}/api/health", timeout=1.0)
                if res.status_code == 200:
                    ready = True
                    break
            except Exception:
                time.sleep(0.5)

        assert ready, "Server failed to boot within 10 seconds"
        print(f"Server is ready at {base_url}")

        with httpx.Client(base_url=base_url, timeout=10.0) as client:
            # 1. Root /
            r = client.get("/")
            assert r.status_code == 200
            assert "text/html" in r.headers["content-type"]
            assert "downhere" in r.text
            print("[PASS] GET / -> 200 text/html")

            # 2. Manifest
            r = client.get("/manifest.webmanifest")
            assert r.status_code == 200
            assert "application/manifest+json" in r.headers["content-type"]
            print("[PASS] GET /manifest.webmanifest -> 200 application/manifest+json")

            # 3. Service Worker
            r = client.get("/sw.js")
            assert r.status_code == 200
            assert "application/javascript" in r.headers["content-type"]
            assert r.headers.get("service-worker-allowed") == "/"
            print("[PASS] GET /sw.js -> 200 application/javascript (Service-Worker-Allowed: /)")

            # 4. Thmanyah Font
            r = client.get("/fonts/thmanyahsans-Regular.otf")
            assert r.status_code == 200
            assert r.headers["content-type"] == "font/otf"
            print("[PASS] GET /fonts/thmanyahsans-Regular.otf -> 200 font/otf")

            # 5. CSS
            r = client.get("/css/apple-theme.css")
            assert r.status_code == 200
            assert "text/css" in r.headers["content-type"]
            print("[PASS] GET /css/apple-theme.css -> 200 text/css")

            # 6. JS Module
            r = client.get("/js/app.js")
            assert r.status_code == 200
            assert "application/javascript" in r.headers["content-type"]
            print("[PASS] GET /js/app.js -> 200 application/javascript")

            # 7. Health probe
            r = client.get("/api/health")
            assert r.status_code == 200
            assert r.json()["status"] in ("healthy", "operational")
            print("[PASS] GET /api/health -> 200 healthy")

            # 8. SPA fallback
            r = client.get("/deep/client/route")
            assert r.status_code == 200
            assert "text/html" in r.headers["content-type"]
            assert "downhere" in r.text
            print("[PASS] GET /deep/client/route -> 200 SPA fallback")

            # 9. API 404
            r = client.get("/api/nonexistent")
            assert r.status_code == 404
            assert r.headers["content-type"] == "application/json"
            print("[PASS] GET /api/nonexistent -> 404 JSON")

        print("\nALL LIVE SERVER TESTS PASSED PERFECTLY!")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    test_live_server()
