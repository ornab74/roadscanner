#!/usr/bin/env python3
"""Playwright smoke test for blog persistence across server restart.

Usage:
  python scripts_blog_persistence_check.py
"""
from __future__ import annotations

import os
import signal
import subprocess
import time
from contextlib import suppress
from datetime import datetime
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
APP = ROOT / "main.py"
BASE_URL = "http://127.0.0.1:3000"
SCREENSHOT_PATH = ROOT / "artifacts" / "blog_persistence_result.png"

ENV = {
    "INVITE_CODE_SECRET_KEY": "testsecret",
    "ENCRYPTION_PASSPHRASE": "testpassphrase",
    "admin_username": "admin",
    "admin_pass": "Admin123!",
    "REGISTRATION_ENABLED": "true",
    "STRICT_PQ2_ONLY": "0",
}


def wait_for_server(timeout: float = 60.0) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            r = requests.get(f"{BASE_URL}/login", timeout=2)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("Server did not start in time")


def start_server() -> subprocess.Popen:
    Path("/var/data").mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(ENV)
    proc = subprocess.Popen(["python", str(APP)], env=env, cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_for_server()
    return proc


def stop_server(proc: subprocess.Popen) -> None:
    with suppress(Exception):
        proc.send_signal(signal.SIGINT)
        proc.wait(timeout=10)
    if proc.poll() is None:
        with suppress(Exception):
            proc.kill()


def test_with_playwright() -> str:
    slug = f"pw-persist-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    title = f"Playwright Persistence {slug}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Login as seeded admin.
        page.goto(f"{BASE_URL}/login", wait_until="networkidle")
        page.fill('input[name="username"]', ENV["admin_username"])
        page.fill('input[name="password"]', ENV["admin_pass"])
        page.click('input[type="submit"], button[type="submit"]')
        page.wait_for_url("**/dashboard", timeout=20000)

        # Create published blog post.
        page.goto(f"{BASE_URL}/settings/blog", wait_until="networkidle")
        page.fill("#title", title)
        page.fill("#slug", slug)
        page.fill("#excerpt", f"Excerpt {slug}")
        page.fill("#content", f"<p>Persistence check content for {slug}</p>")
        page.fill("#tags", "playwright,persistence")
        page.select_option("#status", "published")
        page.click("#btnSave")
        page.wait_for_timeout(1500)

        # Verify pre-restart.
        page.goto(f"{BASE_URL}/blog/{slug}", wait_until="networkidle")
        assert page.locator("h1.title").inner_text().strip() == title
        assert slug in page.locator(".content").inner_text()

        browser.close()

    return slug


def verify_after_restart(slug: str) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(f"{BASE_URL}/blog/{slug}", wait_until="networkidle")
        assert slug in page.content()
        SCREENSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SCREENSHOT_PATH), full_page=True)
        browser.close()


def main() -> None:
    server = start_server()
    try:
        slug = test_with_playwright()
    finally:
        stop_server(server)

    server = start_server()
    try:
        verify_after_restart(slug)
    finally:
        stop_server(server)

    print(f"PASS: persisted blog slug {slug}")
    print(f"Screenshot: {SCREENSHOT_PATH}")


if __name__ == "__main__":
    main()
