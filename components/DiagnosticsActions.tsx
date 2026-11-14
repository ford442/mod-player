import { useCallback, useState } from 'react';
import { buildDiagnosticsBundle, clearFaultReports, serializeDiagnosticsBundle } from '../utils/faultReport';
import { downloadBlob } from '../utils/downloadBlob';

type Status = { tone: 'ok' | 'error'; text: string } | null;

/**
 * "Copy diagnostics" (debug panel): the fault ring + current context as JSON, for a bug report.
 * Decode its wasm frames with `node scripts/symbolicate.mjs report.json`. Falls back to a download
 * when the clipboard is unavailable (no focus, permissions, insecure context).
 */
export function DiagnosticsActions() {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const copy = useCallback(async () => {
    setBusy(true);
    try {
      const bundle = await buildDiagnosticsBundle();
      const json = serializeDiagnosticsBundle(bundle);
      const count = `${bundle.faults.length} fault${bundle.faults.length === 1 ? '' : 's'}`;
      try {
        await navigator.clipboard.writeText(json);
        setStatus({ tone: 'ok', text: `Copied (${count})` });
      } catch {
        downloadBlob(new Blob([json], { type: 'application/json' }), `xasm1-diagnostics-${bundle.createdAt.replace(/[:.]/g, '-')}.json`);
        setStatus({ tone: 'ok', text: `Clipboard unavailable — downloaded (${count})` });
      }
    } catch (e) {
      setStatus({ tone: 'error', text: `Failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(async () => {
    try {
      await clearFaultReports();
      setStatus({ tone: 'ok', text: 'Fault log cleared' });
    } catch (e) {
      setStatus({ tone: 'error', text: `Failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, []);

  return (
    <div className="border-t border-gray-700 pt-2 mt-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void copy()}
          className="rounded border border-green-500/40 px-2 py-0.5 text-[10px] text-green-300 hover:bg-green-900/30 disabled:opacity-50"
          title="Copy the recent fault reports and the current context as JSON (no module data or file names)"
        >
          Copy diagnostics
        </button>
        <button
          type="button"
          onClick={() => void clear()}
          className="rounded border border-gray-600 px-2 py-0.5 text-[10px] text-gray-400 hover:text-white"
        >
          Clear log
        </button>
      </div>
      {status && (
        <div className={`mt-1 text-[10px] ${status.tone === 'ok' ? 'text-green-300' : 'text-red-300'}`} role="status">
          {status.text}
        </div>
      )}
    </div>
  );
}
