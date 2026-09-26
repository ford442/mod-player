import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { DebugInfo } from '../params';
import { DebugInfoSink } from '../debugInfoSink';

/**
 * Debug info for the PatternDisplay debug panel. Returns the published value
 * and a setter-compatible dispatch; the dispatch writes into a ref and only
 * triggers a React render while `panelOpen` is true (throttled, see
 * DebugInfoSink).
 */
export function useThrottledDebugInfo(
  initial: DebugInfo,
  panelOpen: boolean,
): [DebugInfo, React.Dispatch<React.SetStateAction<DebugInfo>>] {
  const [published, setPublished] = useState<DebugInfo>(initial);
  const sinkRef = useRef<DebugInfoSink | null>(null);
  if (!sinkRef.current) {
    sinkRef.current = new DebugInfoSink(initial, setPublished);
  }
  const sink = sinkRef.current;

  useEffect(() => {
    sink.setOpen(panelOpen);
  }, [sink, panelOpen]);

  useEffect(() => () => sink.dispose(), [sink]);

  return [published, sink.dispatch];
}
