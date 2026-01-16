from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu"]
        )
        page = browser.new_page()

        # Mock WebGPU to ensure the component mounts even if the headless browser doesn't fully support it
        page.add_init_script("""
            if (!navigator.gpu) {
                navigator.gpu = {
                    requestAdapter: async () => ({
                        requestDevice: async () => ({
                            createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
                            createBindGroupLayout: () => ({}),
                            createPipelineLayout: () => ({}),
                            createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
                            createBuffer: () => ({ destroy: () => {}, getMappedRange: () => new Uint8Array(1000), unmap: () => {} }),
                            createTexture: () => ({ createView: () => ({}), destroy: () => {} }),
                            createSampler: () => ({}),
                            createBindGroup: () => ({}),
                            createCommandEncoder: () => ({ beginRenderPass: () => ({ setPipeline: () => {}, setBindGroup: () => {}, draw: () => {}, end: () => {} }), finish: () => {} }),
                            queue: { writeBuffer: () => {}, writeTexture: () => {}, submit: () => {}, onSubmittedWorkDone: async () => {} },
                            features: { has: () => true },
                        }),
                        features: { has: () => true },
                    }),
                    getPreferredCanvasFormat: () => 'rgba8unorm',
                };
            }
        """)

        # Wait for server to start
        max_retries = 10
        for i in range(max_retries):
            try:
                page.goto("http://localhost:5173", timeout=3000)
                break
            except:
                print(f"Waiting for server... ({i+1}/{max_retries})")
                time.sleep(2)

        # Click WGSL button
        page.get_by_role("button", name="WGSL").click()

        # Use a more specific locator for the shader dropdown
        # The shader dropdown contains "patternv0.21" in its options, unlike the media dropdown
        # Or we can just grab the first one since it's likely the first one in the DOM order for the pattern view

        # There are two selects.
        # 1. Shader selector
        # 2. Remote media selector

        # We can target the one that has "patternv0.21" as an option
        select = page.locator("select").filter(has_text="patternv0.21")

        options = select.locator("option")
        texts = options.all_inner_texts()
        print("Available shaders:", texts)

        if "patternv0.38" in texts:
            print("Verified patternv0.38 is present")
        else:
            print("ERROR: patternv0.38 missing")

        if "patternv0.39" in texts:
            print("Verified patternv0.39 is present")
        else:
            print("ERROR: patternv0.39 missing")

        if "patternv0.40" in texts:
            print("Verified patternv0.40 is present")
        else:
            print("ERROR: patternv0.40 missing")

        # Select v0.40
        select.select_option(label="patternv0.40")

        # Allow some time for state update
        time.sleep(1)

        # Take screenshot
        page.screenshot(path="verification/shader_v039.png")

        browser.close()

if __name__ == "__main__":
    run()
