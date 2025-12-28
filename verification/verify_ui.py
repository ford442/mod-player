
from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--enable-unsafe-webgpu']
        )
        context = browser.new_context()
        page = context.new_page()

        # Mock GPU support if needed for headless environment (though we use args above)
        # We need to serve the app first. Assuming localhost:5173

        try:
            page.goto('http://localhost:5173')
            # Wait for app to load
            time.sleep(5)

            # Select the shader if possible or check if default is loaded.
            # We want to check chassisv0.37.wgsl visual changes.
            # We might need to select the pattern layout that uses v0.37

            # Find select box for shader/pattern
            # NOTE: We need to see the DOM structure.
            # Let's take a screenshot of initial load first.
            page.screenshot(path='verification/initial_load.png')

            print('Initial load screenshot taken')
        except Exception as e:
            print(f'Error: {e}')
        finally:
            browser.close()

if __name__ == '__main__':
    run()
