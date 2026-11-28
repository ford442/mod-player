Evidence for the Release 1/5 "State of the App" report (issue #561), commit b62e59273f1a67c3db27dceb8217512409895dd4.

These are screenshots of a LOCAL `vite preview --base /xm-player/` serving the exact `dist/` that was deployed to
https://test.1ink.us/xm-player/ (test profile; `version.json` sha b62e592...). They are NOT screenshots of the
deployed URL: from the machine that produced them, test.1ink.us answered HTTP 429 (client-IP throttle) and the page
never finished loading. Chromium 158.0.8127.36 headless on Linux with a software GPU (SwiftShader), deviceScaleFactor 2.

- `*-html.png`    `?renderer=html` (DOM pattern grid)
- `*-default.png` default URL: WebGPU is requested and hard-fails on the software GPU (see report-all-all.json)
- `report-all-all.json` console / failed requests / HTTP >= 400 / redirects / crossOriginIsolated per capture
