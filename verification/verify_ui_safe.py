
from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-gpu'] # Disable GPU to avoid crash if WebGPU is causing issues in this env
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

            print(' taking screenshot...')
            page.screenshot(path='verification/ui_check_safe.png')
            print('Screenshot taken')

        except Exception as e:
            print(f'Error: {e}')
        finally:
            browser.close()

if __name__ == '__main__':
    run()
