const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

const PORT = 34567;
const TOTAL_SIZE = 5 * 1024 * 1024; // 5MB
const DUMMY_DATA = crypto.randomBytes(TOTAL_SIZE);

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': TOTAL_SIZE,
        'Access-Control-Allow-Origin': '*'
    });
    res.end(DUMMY_DATA);
});

server.listen(PORT, async () => {
    console.log(`Test server running on port ${PORT}`);

    // We will mock the engine
    class MockModule {
        constructor() {
            // Allocate a massive heap to simulate WASM heap that can grow
            this.HEAPU8 = new Uint8Array(500 * 1024 * 1024);
            this.allocated = 0;
        }
        _malloc(size) {
            const ptr = this.allocated;
            this.allocated += size;
            return ptr;
        }
        _free(ptr) {}
        _load_module(ptr, size) {
            return true;
        }
    }

    class MockEngine {
        constructor() {
            this.module = new MockModule();
        }
        emit() {}

        async load(data) {
            const uint8 = new Uint8Array(data);
            const ptr = this.module._malloc(uint8.length);
            this.module.HEAPU8.set(uint8, ptr);
            const result = this.module._load_module(ptr, uint8.length);
            this.module._free(ptr);
            return { title: 'Old' };
        }

        async loadFromURL_old(url) {
            const response = await fetch(url);
            const data = await response.arrayBuffer();
            return this.load(data);
        }

        async loadFromURL_new(url) {
            const response = await fetch(url);
            const contentLength = response.headers.get('content-length');
            const totalSize = contentLength ? parseInt(contentLength, 10) : 0;

            if (totalSize > 0 && response.body && this.module) {
                const ptr = this.module._malloc(totalSize);
                const reader = response.body.getReader();
                let offset = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        this.module.HEAPU8.set(value, ptr + offset);
                        offset += value.length;
                    }
                }
                const result = this.module._load_module(ptr, offset);
                this.module._free(ptr);
                return { title: 'New' };
            } else {
                const data = await response.arrayBuffer();
                return this.load(data);
            }
        }
    }

    const engine = new MockEngine();
    const url = `http://localhost:${PORT}/dummy.mod`;

    // Warmup
    for (let i = 0; i < 5; i++) {
        await engine.loadFromURL_old(url);
        await engine.loadFromURL_new(url);
    }
    global.gc && global.gc();

    console.log("Benchmarking OLD method (ArrayBuffer + Copy)");
    let memBefore = process.memoryUsage().heapUsed;
    let start = performance.now();
    for (let i = 0; i < 20; i++) {
        await engine.loadFromURL_old(url);
    }
    let end = performance.now();
    let memAfter = process.memoryUsage().heapUsed;
    console.log(`OLD - Time: ${(end - start).toFixed(2)}ms, Mem Delta: ${((memAfter - memBefore) / 1024 / 1024).toFixed(2)} MB`);

    global.gc && global.gc();

    console.log("Benchmarking NEW method (Stream straight to WASM heap)");
    memBefore = process.memoryUsage().heapUsed;
    start = performance.now();
    for (let i = 0; i < 20; i++) {
        await engine.loadFromURL_new(url);
    }
    end = performance.now();
    memAfter = process.memoryUsage().heapUsed;
    console.log(`NEW - Time: ${(end - start).toFixed(2)}ms, Mem Delta: ${((memAfter - memBefore) / 1024 / 1024).toFixed(2)} MB`);

    server.close();
});
