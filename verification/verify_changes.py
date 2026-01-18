from playwright.sync_api import Page, expect, sync_playwright
import time

def test_ui_changes(page: Page):
    # Mock WebGPU to prevent crashes in headless mode
    page.add_init_script("""
        if (!navigator.gpu) {
            navigator.gpu = {
                requestAdapter: async () => ({
                    requestDevice: async () => ({
                        createShaderModule: () => ({}),
                        createBindGroupLayout: () => ({}),
                        createPipelineLayout: () => ({}),
                        createRenderPipeline: () => ({}),
                        createCommandEncoder: () => ({
                            beginRenderPass: () => ({
                                setPipeline: () => {},
                                setBindGroup: () => {},
                                draw: () => {},
                                end: () => {}
                            }),
                            finish: () => {}
                        }),
                        createBuffer: () => ({ destroy: () => {} }),
                        createTexture: () => ({ createView: () => {} }),
                        createSampler: () => ({}),
                        queue: { writeBuffer: () => {}, submit: () => {}, copyExternalImageToTexture: () => {}, writeTexture: () => {}, onSubmittedWorkDone: async () => {} },
                        features: { has: () => false }
                    }),
                    features: { has: () => false }
                }),
                getPreferredCanvasFormat: () => 'bgra8unorm'
            };
        }
    """)

    page.goto("http://localhost:5173")

    # Wait for the app to load
    page.wait_for_selector("text=VISUALIZER CORE")

    # Verify buttons exist
    horiz_btn = page.get_by_role("button", name="HORIZ")
    circ_btn = page.get_by_role("button", name="CIRC")
    video_btn = page.get_by_role("button", name="VIDEO")

    expect(horiz_btn).to_be_visible()
    expect(circ_btn).to_be_visible()
    expect(video_btn).to_be_visible()

    # Target the visualizer select explicitly
    # We find the label "VISUALIZER CORE:" and get the select in its parent div
    # Note: Playwright doesn't have a direct 'sibling' selector easily in chain, but we can search within the container if we identify it.
    # However, since we saw the output, the visualizer select is the first one.
    # But let's be safer:
    # Use layout selector: select to the right of "VISUALIZER CORE:" label?
    # Or just use the first one since Controls (which has the other select) is rendered later in the DOM usually?

    # Actually, let's use the class characteristic or just .first for now.
    select = page.locator("select").first

    # Click VIDEO
    video_btn.click()

    # Verify dropdown value
    expect(select).to_have_value("patternv0.23.wgsl")

    # Click CIRC
    circ_btn.click()
    expect(select).to_have_value("patternv0.38.wgsl")

    # Click HORIZ
    horiz_btn.click()
    expect(select).to_have_value("patternv0.40.wgsl")

    # Set back to VIDEO for screenshot
    video_btn.click()

    # Ensure update happened
    expect(select).to_have_value("patternv0.23.wgsl")

    # Take screenshot
    page.screenshot(path="/home/jules/verification/verification.png")
    print("Verification complete")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_ui_changes(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
            raise e
        finally:
            browser.close()
