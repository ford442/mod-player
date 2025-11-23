from playwright.sync_api import Page, expect, sync_playwright
import time

def verify_changes(page: Page):
    print("Navigating to app...")
    page.goto("http://localhost:5173")

    # Wait for app to load
    page.wait_for_timeout(2000)

    print("Checking for Volume control...")
    # Check for volume slider
    volume_input = page.locator('input[type="range"]')
    expect(volume_input).to_be_visible()

    print("Checking for Controls bar...")
    # Use text to find the specific section
    controls = page.locator('section', has_text="Play")
    expect(controls).to_be_visible()

    print("Checking for Pattern Display...")
    # Check for canvas (WebGPU pattern display)
    canvas = page.locator('canvas')
    expect(canvas).to_be_visible()

    # Wait a bit more for animation
    page.wait_for_timeout(2000)

    print("Taking screenshot...")
    page.screenshot(path="/home/jules/verification/verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_changes(page)
        finally:
            browser.close()
