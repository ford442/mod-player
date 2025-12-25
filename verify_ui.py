from playwright.sync_api import sync_playwright

def verify_xasm1_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--enable-unsafe-webgpu'])
        page = browser.new_page()

        # Navigate to local server
        page.goto("http://localhost:5173")

        # Log content if timeout
        try:
            page.wait_for_selector("text=XASM-1", timeout=5000)
            page.screenshot(path="verification_ui.png", full_page=True)
            print("Screenshot taken: verification_ui.png")
        except Exception as e:
            print("Failed to find selector. Dumping page content:")
            print(page.content())
            page.screenshot(path="error_ui.png", full_page=True)
            raise e

        browser.close()

if __name__ == "__main__":
    verify_xasm1_ui()
