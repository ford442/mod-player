from playwright.sync_api import sync_playwright

def verify_shaders():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Mock navigator.gpu to avoid crash
        context = browser.new_context()
        context.add_init_script("""
            Object.defineProperty(navigator, 'gpu', {
                get: () => ({
                    requestAdapter: async () => ({
                        requestDevice: async () => ({
                            createShaderModule: () => ({}),
                            createRenderPipeline: () => ({
                                getBindGroupLayout: () => ({})
                            }),
                            createPipelineLayout: () => ({}),
                            createBindGroupLayout: () => ({}),
                            createBindGroup: () => ({}),
                            createBuffer: () => ({
                                destroy: () => {},
                                getMappedRange: () => new ArrayBuffer(1024),
                                unmap: () => {}
                            }),
                            createTexture: () => ({
                                createView: () => ({}),
                                destroy: () => {}
                            }),
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
                            features: {
                                has: () => true
                            }
                        }),
                        features: {
                            has: () => true
                        }
                    }),
                    getPreferredCanvasFormat: () => 'bgra8unorm'
                })
            });
        """)

        page = context.new_page()
        page.goto("http://localhost:5173/")

        # Verify title or header
        print("Page loaded")

        # Take initial screenshot
        page.screenshot(path="verification/verification_initial.png")
        print("Initial screenshot taken")

        # Check for Shader Selectors
        # Square Group
        square_select = page.locator("select").nth(0) # Assuming order
        options = square_select.locator("option").all_text_contents()
        print(f"Square Options: {options}")

        assert "v0.44 (Frosted Wall 64)" in options
        assert "v0.43 (Frosted Wall 32)" in options
        assert "v0.41 (Frosted Clean)" in options

        # Circular Group
        circular_select = page.locator("select").nth(1)
        options = circular_select.locator("option").all_text_contents()
        print(f"Circular Options: {options}")

        assert "v0.45 (Frosted UI)" in options
        assert "v0.42 (Frosted Disc)" in options

        # Verify 3D Mode button exists
        assert page.get_by_text("🎬 3D Mode").is_visible()

        # Verify PatternDisplay canvas exists
        assert page.locator("canvas").nth(0).is_visible()

        print("All checks passed")

        page.screenshot(path="verification/verification_final.png")
        browser.close()

if __name__ == "__main__":
    try:
        verify_shaders()
    except Exception as e:
        print(f"Error: {e}")
        exit(1)
