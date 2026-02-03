
import os
from playwright.sync_api import sync_playwright

def verify_fix(page):
    # Mock WebGPU to prevent crash
    page.add_init_script("""
    navigator.gpu = {
        requestAdapter: async () => ({
            requestDevice: async () => ({
                createShaderModule: () => ({}),
                createPipelineLayout: () => ({}),
                createRenderPipeline: () => ({}),
                createBindGroupLayout: () => ({}),
                createBindGroup: () => ({}),
                createBuffer: () => ({
                    getMappedRange: () => new ArrayBuffer(1024),
                    unmap: () => {},
                    destroy: () => {},
                }),
                createTexture: () => ({
                    createView: () => ({}),
                    destroy: () => {},
                }),
                createSampler: () => ({}),
                createCommandEncoder: () => ({
                    beginRenderPass: () => ({
                        setPipeline: () => {},
                        setBindGroup: () => {},
                        draw: () => {},
                        end: () => {},
                    }),
                    finish: () => ({}),
                }),
                queue: {
                    writeBuffer: () => {},
                    writeTexture: () => {},
                    submit: () => {},
                    onSubmittedWorkDone: async () => {},
                    copyExternalImageToTexture: () => {},
                },
                features: {
                    has: () => true,
                },
            }),
            features: {
                has: () => true,
            },
        }),
        getPreferredCanvasFormat: () => 'bgra8unorm',
    };
    """)

    print("Navigating to app...")
    page.goto("http://localhost:5173/")

    print("Waiting for Play button to be enabled...")
    # The Play button is disabled initially. It becomes enabled when isReady is true.
    # We wait for the button to not have the 'disabled' attribute.
    # Note: In Controls.tsx, the button text is "▶️ Play"
    play_button = page.get_by_role("button", name="▶️ Play")

    # Check if disabled
    if play_button.is_disabled():
        print("Button is currently disabled, waiting...")

    # Wait for it to become enabled (timeout 10s)
    try:
        play_button.wait_for(state="visible", timeout=10000)
        # We need to wait for the disabled attribute to be removed.
        # Playwright's wait_for state="visible" doesn't check enabled.
        # We can use expect, but here in raw python we can poll.
        for i in range(20):
            if not play_button.is_disabled():
                print("Play button is enabled!")
                break
            page.wait_for_timeout(500)
    except Exception as e:
        print(f"Timed out or failed: {e}")

    # Check if the overlay canvas has pointer-events: none
    print("Checking overlay canvas style...")
    # The overlay canvas is the second canvas in .pattern-display
    # We can find it by style zIndex: 2
    overlay_canvas = page.locator("canvas[style*='z-index: 2']")
    if overlay_canvas.count() > 0:
        style = overlay_canvas.get_attribute("style")
        print(f"Overlay style: {style}")
        if "pointer-events: none" in style:
            print("SUCCESS: pointer-events: none is present.")
        else:
            print("FAILURE: pointer-events: none is MISSING.")
    else:
        print("Overlay canvas not found?")

    print("Taking screenshot...")
    page.screenshot(path="verification/fix_verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_fix(page)
        finally:
            browser.close()
