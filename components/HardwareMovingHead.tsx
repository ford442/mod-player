import React, { useState, useCallback } from 'react';

interface HardwareMovingHeadProps {
  onClose: () => void;
}

export const HardwareMovingHead: React.FC<HardwareMovingHeadProps> = ({ onClose }) => {
  const [wsUrl, setWsUrl] = useState('ws://192.168.1.100/ws');
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [pan, setPan] = useState(90);
  const [tilt, setTilt] = useState(90);
  const [r, setR] = useState(255);
  const [g, setG] = useState(128);
  const [b, setB] = useState(0);
  const [intensity, setIntensity] = useState(200);

  const connect = useCallback(() => {
    if (socket) socket.close();
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    setSocket(ws);
  }, [wsUrl, socket]);

  const send = useCallback(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ pan, tilt, r, g, b, intensity }));
    }
  }, [socket, pan, tilt, r, g, b, intensity]);

  React.useEffect(() => {
    send();
  }, [pan, tilt, r, g, b, intensity, send]);

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/95 text-gray-200 overflow-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-white">DIY LED Moving Head</h1>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            Close
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-semibold mb-4 text-cyan-400">Control Panel</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1">WebSocket URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={wsUrl}
                    onChange={(e) => setWsUrl(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
                  />
                  <button
                    onClick={connect}
                    className={`px-4 py-2 rounded text-sm ${
                      connected ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-500'
                    }`}
                  >
                    {connected ? 'Connected' : 'Connect'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm">Pan: {pan}</label>
                <input type="range" min="0" max="180" value={pan} onChange={(e) => setPan(+e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-sm">Tilt: {tilt}</label>
                <input type="range" min="0" max="180" value={tilt} onChange={(e) => setTilt(+e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-sm">Red: {r}</label>
                <input type="range" min="0" max="255" value={r} onChange={(e) => setR(+e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-sm">Green: {g}</label>
                <input type="range" min="0" max="255" value={g} onChange={(e) => setG(+e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-sm">Blue: {b}</label>
                <input type="range" min="0" max="255" value={b} onChange={(e) => setB(+e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-sm">Intensity: {intensity}</label>
                <input type="range" min="0" max="255" value={intensity} onChange={(e) => setIntensity(+e.target.value)} className="w-full" />
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 text-cyan-400">Project Docs</h2>
            <p className="text-sm mb-4 opacity-80">
              Full design, parts list, wiring, and firmware live in the repo:
            </p>
            <a
              href="https://github.com/ford442/mod-player/tree/feat/diy-led-moving-head/hardware/diy-led-moving-head"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline text-sm"
            >
              hardware/diy-led-moving-head/
            </a>
            <ul className="mt-4 text-sm space-y-2 opacity-80">
              <li>• ESP32 + 2× SG90 servos + pan/tilt bracket</li>
              <li>• 3–10 W RGB LED with MOSFET PWM</li>
              <li>• Separate 5 V supply for servos/LED</li>
              <li>• WebSocket control from the browser</li>
              <li>• Estimated cost: $30–50</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
