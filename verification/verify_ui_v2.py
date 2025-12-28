
from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--enable-unsafe-webgpu', '--no-sandbox']
        )
        context = browser.new_context()
        page = context.new_page()

        try:
            print('Navigating...')
            page.goto('http://localhost:5173')

            # Wait for content
            print('Waiting for content...')
            page.wait_for_selector('canvas', timeout=10000)

            # Give it a moment to render
            time.sleep(2)

            # Try to select the v0.37 shader if not already selected
            # The select element might have a specific ID or we can find by combobox role
            # Let's dump the page content to see how to select

            # Assuming there is a select box for shader file
            # page.select_option('select', label='patternv0.37.wgsl')
            # or similar.

            print(' taking screenshot...')
            page.screenshot(path='verification/ui_check.png')
            print('Screenshot taken')

        except Exception as e:
            print(f'Error: {e}')
        finally:
            browser.close()

if __name__ == '__main__':
    run()
