from playwright.sync_api import sync_playwright, expect
import time

def test_splash_shader_selection(page):
    print("Loading application...")
    page.goto("http://localhost:5173")

    # Wait for the app to be ready
    print("Waiting for app initialization...")
    try:
        page.wait_for_selector("text=WGSL", timeout=5000)
    except:
        print("WGSL button not found, app might be in HTML mode or failed init.")

    # Select the WGSL mode button
    print("Ensuring WGSL mode...")
    page.get_by_role("button", name="WGSL").click()

    # Find the shader selector dropdown
    print("Selecting shader v0.18...")
    page.wait_for_selector("select")
    page.select_option("select", value="patternv0.18.wgsl")

    # Wait a moment
    time.sleep(2)

    # Take a screenshot
    print("Taking screenshot...")
    page.screenshot(path="verification/splash_shader_v0.18.png")
    print("Screenshot saved.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu"]
        )
        context = browser.new_context()

        # Enhanced Mock for WebGPU
        context.add_init_script("""
            if (!navigator.gpu) {
                console.log("Mocking WebGPU...");
                navigator.gpu = {
                    requestAdapter: async () => ({
                        requestDevice: async () => ({
                            createCommandEncoder: () => ({
                                beginRenderPass: () => ({
                                    setPipeline: () => {},
                                    setBindGroup: () => {},
                                    draw: () => {},
                                    end: () => {}
                                }),
                                finish: () => {}
                            }),
                            createBindGroup: () => {},
                            createBindGroupLayout: () => {},
                            createPipelineLayout: () => {},
                            createRenderPipeline: () => ({
                                getBindGroupLayout: () => ({})
                            }),
                            createShaderModule: () => ({
                                getCompilationInfo: async () => ({ messages: [] })
                            }),
                            queue: {
                                writeBuffer: () => {},
                                submit: () => {}
                            },
                            createBuffer: () => ({}),
                            createTexture: () => ({
                                createView: () => {}
                            }),
                            createSampler: () => {}
                        }),
                        limits: {}
                    })
                };
            }
        """)

        page = context.new_page()
        try:
            test_splash_shader_selection(page)
        except Exception as e:
            print(f"Test failed: {e}")
            # Take emergency screenshot
            try:
                page.screenshot(path="verification/error_state.png")
            except:
                pass
        finally:
            browser.close()
