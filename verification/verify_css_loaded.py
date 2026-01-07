from playwright.sync_api import sync_playwright
import sys

def verify_css_loaded():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to app...")
        try:
            page.goto("http://localhost:5173", timeout=10000)
            page.wait_for_load_state("networkidle")
        except Exception as e:
            print(f"Error navigating: {e}")
            sys.exit(1)

        # Check if the body has the font-family 'Inter'
        font_family = page.eval_on_selector("body", "el => getComputedStyle(el).fontFamily")
        print(f"Body font-family: {font_family}")

        if "Inter" in font_family:
            print("SUCCESS: CSS is loaded and applied.")
        else:
            print("FAILURE: CSS does not seem to be applied.")
            sys.exit(1)

        # Take a screenshot
        page.screenshot(path="verification/verification.png")
        print("Screenshot taken: verification/verification.png")

        browser.close()

if __name__ == "__main__":
    verify_css_loaded()
