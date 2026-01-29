import sys
from playwright.sync_api import sync_playwright

def verify_shader_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto("http://localhost:5180")
        
        # 1. Select v0.45 Shader
        print("Selecting v0.45...")
        page.select_option("select:has-text('Circular')", "patternv0.45.wgsl")
        page.wait_for_timeout(1000) # Wait for shader load
        
        # 2. Click "Play" area on Canvas (Bottom Left approx 6% from left, 95% from top)
        # Canvas is likely centered. We aim for the shader coordinate (-0.44, -0.45)
        # Screen space: 0.5 - 0.44 = 0.06 (6% width), 0.5 - (-0.45) = 0.95 (95% height)
        canvas = page.locator("canvas").first
        box = canvas.bounding_box()
        
        click_x = box["x"] + (box["width"] * 0.06)
        click_y = box["y"] + (box["height"] * 0.95)
        
        print(f"Clicking Canvas at {click_x}, {click_y}")
        page.mouse.click(click_x, click_y)
        page.wait_for_timeout(500)
        
        # 3. Assert State
        status = page.inner_text("h1") # Header status
        print(f"App Status: {status}")
        
        if "Playing" in status:
            print("✅ SUCCESS: Canvas click triggered Play")
            sys.exit(0)
        else:
            print("❌ FAILURE: Canvas click did not trigger Play")
            sys.exit(1)

if __name__ == "__main__":
    verify_shader_ui()