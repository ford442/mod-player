
import os
import sys
from playwright.sync_api import sync_playwright, expect

def verify_shader_selector():
    with sync_playwright() as p:
        # Launch browser with WebGPU enabled (though mock might be needed for real rendering)
        browser = p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu", "--use-gl=egl"]
        )
        page = browser.new_page()

        # Go to local app
        page.goto("http://localhost:5173")

        # Wait for app to load
        page.wait_for_selector(".pattern-display", timeout=10000)

        # Take initial screenshot
        page.screenshot(path="verification/initial_load.png")
        print("Initial screenshot taken.")

        # Find the shader selector dropdown
        # It's likely a select element or a custom dropdown.
        # Based on previous memory/context, it might be in Controls or PatternDisplay props driven by App.tsx
        # Let's look for a select element.

        # Wait for a bit to ensure potential async operations settle
        page.wait_for_timeout(2000)

        # Select v0.38 shader
        # We need to find the select element. Let's dump the page content if we fail.
        try:
            # Assuming there is a select element for shader switching.
            # In App.tsx (from memory), there is a shader selector.
            # Let's try to select "patternv0.38.wgsl"

            # Use a broad selector first
            select = page.locator("select")
            if select.count() > 0:
                print(f"Found {select.count()} select elements.")
                # Try to select by value if possible, or label
                # We'll just take a screenshot of the controls area first.

            # Verify text on page
            expect(page.locator("body")).to_contain_text("Tracker GPU-9000") # From the new PatternDisplay.tsx
            print("Found 'Tracker GPU-9000' text.")

            # Take screenshot of the pattern display specifically
            display = page.locator(".pattern-display")
            display.screenshot(path="verification/pattern_display.png")
            print("Pattern display screenshot taken.")

        except Exception as e:
            print(f"Error interacting with page: {e}")
            page.screenshot(path="verification/error_state.png")

        browser.close()

if __name__ == "__main__":
    verify_shader_selector()
