
import os
from playwright.sync_api import sync_playwright, expect

def test_ui(page):
    # Mock WebGPU to prevent crash/error
    page.add_init_script("""
    Object.defineProperty(navigator, 'gpu', {
        get: () => ({
            requestAdapter: async () => ({
                requestDevice: async () => ({
                    createShaderModule: () => ({}),
                    createBindGroupLayout: () => ({}),
                    createPipelineLayout: () => ({}),
                    createRenderPipeline: () => ({}),
                    createBuffer: () => ({ destroy: () => {} }),
                    createBindGroup: () => ({}),
                    createCommandEncoder: () => ({
                        beginRenderPass: () => ({
                            setPipeline: () => {},
                            setBindGroup: () => {},
                            draw: () => {},
                            end: () => {}
                        }),
                        finish: () => {}
                    }),
                    queue: {
                        writeBuffer: () => {},
                        submit: () => {}
                    }
                }),
                features: new Set()
            })
        })
    });
    """)

    page.goto("http://localhost:5173")

    # Wait for the app to load
    page.wait_for_selector("text=Tracker GPU-9000", timeout=5000)

    # Verify the new labels exist
    expect(page.get_by_text("Square", exact=True)).to_be_visible()
    expect(page.get_by_text("Circular", exact=True)).to_be_visible()
    expect(page.get_by_text("Video", exact=True)).to_be_visible()

    # Take screenshot
    os.makedirs("verification", exist_ok=True)
    page.screenshot(path="verification/shader_ui_verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_ui(page)
            print("Verification script finished successfully.")
        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification/error_ui.png")
        finally:
            browser.close()
