/**
 * Lazy MIDI-out panel (#538): the controller and its chunk load when the panel first renders — and
 * not at all where Web MIDI does not exist, so Safari / stock Firefox never fetch it.
 */
import { lazy, Suspense } from 'react';
import { isWebMidiSupported } from '../utils/midiMappings';

const MidiOutPanel = lazy(() => import('./MidiOutPanel').then((m) => ({ default: m.MidiOutPanel })));

export function MidiOutPanelLazy({ isDarkMode }: { isDarkMode: boolean }) {
  if (!isWebMidiSupported()) return null;
  return (
    <Suspense fallback={null}>
      <MidiOutPanel isDarkMode={isDarkMode} />
    </Suspense>
  );
}
