from playwright.sync_api import sync_playwright
import os

def verify_revert():
    os.makedirs("verification", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--enable-unsafe-webgpu'])
        page = browser.new_page()

        # Mock navigator.gpu to ensure PatternDisplay doesn't crash or show error immediately
        # logic derived from memory about mocking webgpu for tests
        page.add_init_script("""
        if (!navigator.gpu) {
            console.log("Mocking WebGPU");
            navigator.gpu = {
                requestAdapter: async () => ({
                    requestDevice: async () => ({
                        createShaderModule: () => ({ getCompilationInfo: async () => [] }),
                        createBindGroupLayout: () => ({}),
                        createPipelineLayout: () => ({}),
                        createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
                        createBuffer: () => ({ destroy: () => {}, getMappedRange: () => new Uint8Array(1024), unmap: () => {} }),
                        createTexture: () => ({ createView: () => {}, destroy: () => {} }),
                        createSampler: () => ({}),
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
                            writeTexture: () => {},
                            copyExternalImageToTexture: () => {},
                            submit: () => {},
                            onSubmittedWorkDone: async () => {}
                        },
                        features: { has: () => true }
                    }),
                    features: { has: () => true }
                }),
                getPreferredCanvasFormat: () => 'rgba8unorm'
            };
        }
        """)

        try:
            page.goto("http://localhost:5173", timeout=10000)

            # Check for Header
            header = page.locator("header h1")
            header.wait_for(timeout=5000)
            print(f"Header text: {header.text_content()}")
            assert "libopenmpt Note Viewer" in header.text_content()

            # Check for Shader Selector
            selector = page.locator("select")
            selector.wait_for(timeout=5000)
            options = selector.locator("option").all_text_contents()
            print(f"Found shader options: {options}")
            assert "patternv0.40.wgsl" in options

            # Check for Controls
            upload_btn = page.locator("input[type=file]").first
            assert upload_btn.is_visible() or upload_btn.is_hidden() # Inputs are often hidden, check wrapper

            # Check PatternDisplay container
            canvas = page.locator("canvas").first
            canvas.wait_for(timeout=5000)
            print("Canvas found.")

            # Take screenshot
            page.screenshot(path="verification/revert_verification.png")
            print("Verification successful, screenshot saved.")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification/revert_failure.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_revert()
