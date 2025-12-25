import { useState, useEffect, useRef, useCallback } from 'react';
import type { LibOpenMPT, ModuleInfo, PatternMatrix, PatternCell } from '../types';

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 4096;
const INITIAL_STATUS = "Loading library...";
const INITIAL_MODULE_INFO: ModuleInfo = { title: '...', order: 0, row: 0, bpm: 0, numChannels: 0 };
const DEFAULT_MODULE_URL = 'https://raw.githubusercontent.com/deskjet/chiptunes/master/mods/4mat/4-mat_-_space_debris.mod';


const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const decayTowards = (value: number, target: number, rate: number, dt: number) => lerp(value, target, 1 - Math.exp(-rate * dt));

interface ChannelShadowState {
  volume: number;
  pan: number;
  freq: number;
  trigger: number;
  noteAge: number;
  activeEffect: number;
  effectValue: number;
  isMuted: number;
}

const decodeEffectCode = (cell?: PatternCell): { activeEffect: number; intensity: number } => {
  if (!cell?.text) return { activeEffect: 0, intensity: 0 };
  const text = cell.text.trim().toUpperCase();
  const match = text.match(/([0-9A-F])([0-9A-F]{2})/);
  if (!match) return { activeEffect: 0, intensity: 0 };
  const code = match[1];
  const value = parseInt(match[2], 16) / 255;
  switch (code) {
    case '4': return { activeEffect: 1, intensity: value }; // Vibrato
    case '3': return { activeEffect: 2, intensity: value }; // Portamento
    case '7': return { activeEffect: 3, intensity: value }; // Tremolo
    case '0':
      if (match[2] !== '00') return { activeEffect: 4, intensity: value }; // Arpeggio
      break;
    case 'R': return { activeEffect: 5, intensity: value }; // Retrigger
    default: break;
  }
  return { activeEffect: 0, intensity: value };
};

const extractNote = (cell?: PatternCell): string | undefined => cell?.text?.match(/[A-G][#-]?\d/)?.[0];
const noteToFreq = (note?: string): number => {
  if (!note) return 0;
  const n = note.toUpperCase();
  const map: Record<string, number> = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };
  const match = n.match(/^([A-G](?:#|B)?)\-?(\d)$/);
  if (!match) return 0;
  const semitone = map[match[1]] ?? 0;
  const midi = (parseInt(match[2], 10) + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
};

export function useLibOpenMPT(volume: number = 1.0) {
  const [status, setStatus] = useState<string>(INITIAL_STATUS);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isModuleLoaded, setIsModuleLoaded] = useState<boolean>(false);
  const [moduleInfo, setModuleInfo] = useState<ModuleInfo>(INITIAL_MODULE_INFO);
  const [patternData, setPatternData] = useState<string>('... Waiting for module to play ...');
  const [sequencerMatrix, setSequencerMatrix] = useState<PatternMatrix | null>(null);
  const [sequencerCurrentRow, setSequencerCurrentRow] = useState<number>(0);
  const [sequencerGlobalRow, setSequencerGlobalRow] = useState<number>(0);
  const [totalPatternRows, setTotalPatternRows] = useState<number>(0);
  const [playbackSeconds, setPlaybackSeconds] = useState<number>(0);
  const [playbackRowFraction, setPlaybackRowFraction] = useState<number>(0);
  const [channelStates, setChannelStates] = useState<ChannelShadowState[]>([]);
  const [kickTrigger, setKickTrigger] = useState<number>(0);
  const [beatPhase, setBeatPhase] = useState<number>(0);
  const [grooveAmount, setGrooveAmount] = useState<number>(0);
  const [activeChannels, setActiveChannels] = useState<number>(0);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [panValue, setPanValue] = useState<number>(0);

  const libopenmptRef = useRef<LibOpenMPT | null>(null);
  const currentModulePtr = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const stereoPannerRef = useRef<StereoPannerNode | null>(null);
  const rowBufferRef = useRef<Record<string, string>>({});
  const patternMatricesRef = useRef<Record<number, PatternMatrix>>({});
  const animationFrameHandle = useRef<number>(0);
  const moduleInfoRef = useRef(moduleInfo);
  const isPlayingRef = useRef(isPlaying);
  const isLoopingRef = useRef(isLooping);
  const gainNodeRef = useRef<GainNode | null>(null);

  useEffect(() => {
    moduleInfoRef.current = moduleInfo;
  }, [moduleInfo]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  // Update volume when volume prop changes
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

  const stopMusic = useCallback((ended = false) => {
    if (!scriptNodeRef.current) return;

    scriptNodeRef.current.disconnect();
    scriptNodeRef.current = null;
    if (stereoPannerRef.current) {
      stereoPannerRef.current.disconnect();
      stereoPannerRef.current = null;
    }
    // Disconnect gain node if needed, but it's usually fine to leave it connected to destination

    setIsPlaying(false);
    cancelAnimationFrame(animationFrameHandle.current);

    if (currentModulePtr.current !== 0 && libopenmptRef.current) {
      try {
        libopenmptRef.current._openmpt_module_set_position_order_row(currentModulePtr.current, 0, 0);
      } catch (e) {
        console.error("Error resetting module position:", e);
      }
    }

    setPatternData(ended ? '... Song Ended ...' : '... Stopped ...');
    if (ended) {
        setStatus(`Finished playing "${moduleInfoRef.current.title}".`);
    }
  }, []);

  const preCachePatternData = useCallback((modPtr: number, lib: LibOpenMPT, title: string) => {
    setStatus("Caching pattern data...");
    rowBufferRef.current = {};
    patternMatricesRef.current = {};
    setTimeout(() => {
        try {
            const numOrders = lib._openmpt_module_get_num_orders(modPtr);
            const numChannels = lib._openmpt_module_get_num_channels(modPtr);
            setModuleInfo(prev => ({ ...prev, numChannels }));

            for (let o = 0; o < numOrders; o++) {
                const pattern = lib._openmpt_module_get_order_pattern(modPtr, o);
                if (pattern >= lib._openmpt_module_get_num_patterns(modPtr)) continue;
                const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, pattern);

                // initialize matrix rows
                const matrixRows: PatternCell[][] = Array.from({ length: numRows }, () =>
                    Array.from({ length: numChannels }, () => ({ type: 'empty', text: '' }))
                );

                for (let r = 0; r < numRows; r++) {
                     let line = "";
                     for (let c = 0; c < numChannels; c++) {
                         const commandPtr = lib._openmpt_module_format_pattern_row_channel(modPtr, pattern, r, c, 12, 1);
                         const commandStr = lib.UTF8ToString(commandPtr);
                         lib._openmpt_free_string(commandPtr);
                         line += " " + commandStr.replace(/ /g, '&nbsp;') + " |";

                        // Parse commandStr into a PatternCell (simple heuristics)
                        const raw = (commandStr || '').trim();
                        let cellType: 'note' | 'effect' | 'instrument' | 'empty' = 'empty';
                        if (!raw || /^[-\.\s]+$/.test(raw)) {
                            cellType = 'empty';
                        } else if (/[A-Ga-g][#b]?\d/.test(raw)) {
                            // e.g., C-4, A#3
                            cellType = 'note';
                        } else if (/^\d{1,3}$/.test(raw) || /^i\d+/i.test(raw)) {
                            // pure numeric instrument ids
                            cellType = 'instrument';
                        } else if (/^[0-9A-Fa-f]{1,4}$/.test(raw) || /[A-Za-z]+=/.test(raw) || /[0-9A-Fa-f]{1,2}/.test(raw)) {
                            cellType = 'effect';
                        } else {
                            // default to effect for other non-empty commands
                            cellType = 'effect';
                        }

                        // Structured Data Extraction (0=Note, 1=Inst, 2=VolCmd, 3=EffCmd, 4=VolVal, 5=EffVal)
                        let note = 0, inst = 0, volCmd = 0, effCmd = 0, volVal = 0, effVal = 0;
                        if (lib._openmpt_module_get_pattern_row_channel_command) {
                           note = lib._openmpt_module_get_pattern_row_channel_command(modPtr, pattern, r, c, 0);
                           inst = lib._openmpt_module_get_pattern_row_channel_command(modPtr, pattern, r, c, 1);
                           volCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, pattern, r, c, 2);
                           effCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, pattern, r, c, 3);
                           volVal = lib._openmpt_module_get_pattern_row_channel_command(modPtr, pattern, r, c, 4);
                           effVal = lib._openmpt_module_get_pattern_row_channel_command(modPtr, pattern, r, c, 5);
                        }

                        matrixRows[r][c] = {
                            type: cellType,
                            text: raw,
                            note, inst, volCmd, effCmd, volVal, effVal
                        };
                     }
                     rowBufferRef.current[`${o}-${r}`] = line;
                 }

                patternMatricesRef.current[o] = {
                     order: o,
                     patternIndex: pattern,
                     numRows,
                     numChannels,
                     rows: matrixRows,
                 };
             }
             // compute total rows across orders
             {
               let total = 0;
               const keys = Object.keys(patternMatricesRef.current);
               for (let idx = 0; idx < keys.length; idx++) {
                 const k = Number(keys[idx]);
                 const m = patternMatricesRef.current[k];
                 if (m) total += m.numRows;
               }
               setTotalPatternRows(total);
             }
             setStatus(`Loaded "${title}". Ready to play.`);
             console.log("Pattern data cached.");
         } catch (e) {
             console.error("Failed to cache pattern data:", e);
             setStatus("Error: Failed to cache patterns. See console.");
         }
     }, 50);
   }, []);

  const processModuleData = useCallback(async (fileData: Uint8Array, fileName: string) => {
    if (!libopenmptRef.current) return;

    if (isPlayingRef.current) {
      stopMusic(false);
    }

    if (currentModulePtr.current !== 0) {
        libopenmptRef.current._openmpt_module_destroy(currentModulePtr.current);
        currentModulePtr.current = 0;
    }
    rowBufferRef.current = {};
    patternMatricesRef.current = {};
    setIsModuleLoaded(false);

    setStatus(`Loading "${fileName}"...`);

    try {
        const lib = libopenmptRef.current;

        const bufferPtr = lib._malloc(fileData.length);
        lib.HEAPU8.set(fileData, bufferPtr);

        const modPtr = lib._openmpt_module_create_from_memory2(bufferPtr, fileData.length, 0, 0, 0, 0, 0, 0, 0);
        lib._free(bufferPtr);

        if (modPtr === 0) {
            throw new Error(`Failed to load module "${fileName}".`);
        }
        currentModulePtr.current = modPtr;

        const titleKeyPtr = lib.stringToUTF8("title");
        const titleValuePtr = lib._openmpt_module_get_metadata(modPtr, titleKeyPtr);
        const title = lib.UTF8ToString(titleValuePtr) || fileName;
        lib._free(titleKeyPtr);
        lib._openmpt_free_string(titleValuePtr);

        setModuleInfo({ ...INITIAL_MODULE_INFO, title });
        setIsModuleLoaded(true);
        preCachePatternData(modPtr, lib, title);

    } catch (e) {
        console.error("Failed to load module:", e);
        const error = e as Error;
        setStatus(`Error: ${error.message}. See console.`);
        if (error.name === "TypeError") {
            setStatus("Error: libopenmpt.js may be missing required C API functions.");
        }
    }
  }, [stopMusic, preCachePatternData]);

  const loadModule = useCallback(async (file: File) => {
    const fileData = new Uint8Array(await file.arrayBuffer());
    await processModuleData(fileData, file.name);
  }, [processModuleData]);

  const updateUI = useCallback(() => {
    if (!libopenmptRef.current || currentModulePtr.current === 0) return;

    try {
      const lib = libopenmptRef.current;
      const modPtr = currentModulePtr.current;

      const order = lib._openmpt_module_get_current_order(modPtr);
      const row = lib._openmpt_module_get_current_row(modPtr);
      const positionSeconds = lib._openmpt_module_get_position_seconds(modPtr);
      const bpm = lib._openmpt_module_get_current_estimated_bpm(modPtr);
      const tempo2 = lib._openmpt_module_get_current_tempo2?.(modPtr) ?? bpm;
      const speed = lib._openmpt_module_get_current_speed?.(modPtr) ?? 6;
      const playingChannels = lib._openmpt_module_get_current_playing_channels?.(modPtr) ?? moduleInfoRef.current.numChannels;

      setModuleInfo(prev => ({ ...prev, order, row, bpm: Math.round(bpm) }));
      setPlaybackSeconds(positionSeconds);
      setActiveChannels(playingChannels);

      setBeatPhase((prev) => (prev + (tempo2 / 60) * (1 / 60)) % 1);
      setGrooveAmount((prev) => decayTowards(prev, speed % 2 === 0 ? 0 : 0.1, 3, 1 / 60));

      const rowsPerSecond = bpm > 0 ? (bpm / 60) * 4 : 0;
      const fractionalRow = rowsPerSecond > 0 ? positionSeconds * rowsPerSecond : row;
      setPlaybackRowFraction(fractionalRow);

      // update sequencer state from cached matrices
      const matrix = patternMatricesRef.current[order] ?? null;
      if (matrix) {
        setSequencerMatrix(matrix);
      } else {
        setSequencerMatrix(null);
      }
      setSequencerCurrentRow(row);

      const numChannels = matrix?.numChannels ?? moduleInfoRef.current.numChannels;
      const newChannelStates: ChannelShadowState[] = [];
      for (let ch = 0; ch < numChannels; ch++) {
        const vu = lib._openmpt_module_get_current_channel_vu_mono?.(modPtr, ch) ?? 0;
        const vuL = lib._openmpt_module_get_current_channel_vu_left?.(modPtr, ch) ?? vu;
        const vuR = lib._openmpt_module_get_current_channel_vu_right?.(modPtr, ch) ?? vu;
        const pan = Math.max(-1, Math.min(1, vuR - vuL));
        const volume = Math.min(1, vu);
        const isMuted = lib._openmpt_module_get_channel_mute_status?.(modPtr, ch) ?? 0;

        const rowCells = matrix?.rows[row] ?? [];
        const cell = rowCells[ch];
        const { activeEffect, intensity } = decodeEffectCode(cell);
        const noteMatch = extractNote(cell);
        const freq = noteToFreq(noteMatch);
        const trigger = noteMatch ? 1 : 0;

        const prev = channelStates[ch];
        const noteAge = trigger ? 0 : (prev?.noteAge ?? 0) + (1 / 60);

        newChannelStates.push({
          volume,
          pan,
          freq,
          trigger,
          noteAge,
          activeEffect,
          effectValue: intensity,
          isMuted,
        });
      }
      setChannelStates(newChannelStates);
      if (newChannelStates[0]?.trigger) {
        setKickTrigger(1);
      } else {
        setKickTrigger(prev => decayTowards(prev, 0, 8, 1 / 60));
      }
    } catch (e) {
      console.error("Error in UI update:", e);
    }

    animationFrameHandle.current = requestAnimationFrame(updateUI);
  }, [channelStates]);

  const play = useCallback(() => {
    if (isPlaying || currentModulePtr.current === 0 || !libopenmptRef.current) return;

    try {
      if (!audioContextRef.current) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
      }

      if (!gainNodeRef.current) {
        gainNodeRef.current = audioContextRef.current.createGain();
        gainNodeRef.current.connect(audioContextRef.current.destination);
      }
      gainNodeRef.current.gain.value = volume;

      // Ensure we have a typed reference to the lib before using it
      const lib = libopenmptRef.current as LibOpenMPT;

      const modPtr = currentModulePtr.current;
      const leftBufferPtr = lib._malloc(BUFFER_SIZE * 4);
      const rightBufferPtr = lib._malloc(BUFFER_SIZE * 4);

      scriptNodeRef.current = audioContextRef.current.createScriptProcessor(BUFFER_SIZE, 0, 2);
      scriptNodeRef.current.onaudioprocess = (e) => {
        try {
          const frames = lib._openmpt_module_read_float_stereo(modPtr, SAMPLE_RATE, BUFFER_SIZE, leftBufferPtr, rightBufferPtr);
          if (frames === 0) {
            if (isLoopingRef.current) {
              try {
                lib._openmpt_module_set_position_order_row(modPtr, 0, 0);
              } catch (resetErr) {
                console.error("Error resetting position for loop:", resetErr);
                setTimeout(() => stopMusic(true), 0);
              }
              return;
            } else {
              setTimeout(() => stopMusic(true), 0);
              return;
            }
          }

          const leftOutput = e.outputBuffer.getChannelData(0);
          const rightOutput = e.outputBuffer.getChannelData(1);
          const leftHeap = new Float32Array(lib.HEAPF32.buffer, leftBufferPtr, frames);
          const rightHeap = new Float32Array(lib.HEAPF32.buffer, rightBufferPtr, frames);
          leftOutput.set(leftHeap);
          rightOutput.set(rightHeap);
        } catch (audioErr) {
          console.error("Error in audio process:", audioErr);
          setTimeout(() => stopMusic(false), 0);
        }
      };

      // Clean up any existing panner before creating a new one
      if (stereoPannerRef.current) {
        stereoPannerRef.current.disconnect();
      }

      // Create stereo panner node for panning control
      stereoPannerRef.current = audioContextRef.current.createStereoPanner();
      stereoPannerRef.current.pan.value = panValue;

      // Connect: ScriptProcessor -> StereoPanner -> GainNode -> Destination
      scriptNodeRef.current.connect(stereoPannerRef.current);
      stereoPannerRef.current.connect(gainNodeRef.current);
      gainNodeRef.current.connect(audioContextRef.current.destination);

      setIsPlaying(true);
      setStatus(`Playing "${moduleInfoRef.current.title}"...`);
      animationFrameHandle.current = requestAnimationFrame(updateUI);

    } catch (e) {
      console.error("Failed to start music:", e);
      setStatus("Error: Failed to start playback. See console.");
    }
  }, [isPlaying, stopMusic, updateUI, panValue, volume]);

  useEffect(() => {
    const init = async () => {
      if (!window.libopenmptReady) {
        setStatus("Error: libopenmpt initialization script not found.");
        console.error("window.libopenmptReady promise not found. Check index.html.");
        return;
      }
      try {
        const lib = await window.libopenmptReady as LibOpenMPT;

        if (!lib.UTF8ToString) {
          console.warn('Polyfilling libopenmpt.UTF8ToString...');
          lib.UTF8ToString = (ptr) => {
            let str = '';
            if (!ptr) return str;
            const heap = lib.HEAPU8;
            for (let i = 0; heap[ptr + i] !== 0; i++) {
              str += String.fromCharCode(heap[ptr + i]);
            }
            return str;
          };
        }
        if (!lib.stringToUTF8) {
          console.warn('Polyfilling libopenmpt.stringToUTF8...');
          lib.stringToUTF8 = (jsString) => {
            const length = (jsString.length << 2) + 1;
            const ptr = lib._malloc(length);
            const heap = lib.HEAPU8;
            let i = 0, j = 0;
            while (i < jsString.length) {
                heap[ptr + j++] = jsString.charCodeAt(i++);
            }
            heap[ptr + j] = 0;
            return ptr;
          };
        }

        libopenmptRef.current = lib;
        setIsReady(true);
      } catch (err) {
        setStatus("Error: Audio library failed to load. See console.");
        console.error("Error awaiting libopenmptReady:", err);
      }
    };

    init();

    return () => {
      console.log("Cleaning up libopenmpt resources.");
      if (scriptNodeRef.current) {
        scriptNodeRef.current.disconnect();
      }
      if (stereoPannerRef.current) {
        stereoPannerRef.current.disconnect();
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      if (currentModulePtr.current !== 0 && libopenmptRef.current) {
        libopenmptRef.current._openmpt_module_destroy(currentModulePtr.current);
      }
      cancelAnimationFrame(animationFrameHandle.current);
    };
  }, []);

  // Update panning when panValue changes
  useEffect(() => {
    if (stereoPannerRef.current) {
      stereoPannerRef.current.pan.value = panValue;
    }
  }, [panValue]);

  useEffect(() => {
    if (isReady) {
      const loadDefault = async () => {
        const fileName = DEFAULT_MODULE_URL.split('/').pop() || 'default.mod';
        setStatus(`Fetching "${fileName}"...`);
        try {
          const response = await fetch(DEFAULT_MODULE_URL);
          if (!response.ok) throw new Error(`Failed to fetch module: ${response.statusText}`);
          const arrayBuffer = await response.arrayBuffer();
          const fileData = new Uint8Array(arrayBuffer);
          await processModuleData(fileData, fileName);
        } catch (e) {
          console.error("Failed to load default module:", e);
          setStatus(`Error fetching default module. See console.`);
        }
      };
      loadDefault();
    }
  }, [isReady, processModuleData]);

  const seekToStep = (stepIndex: number) => {
    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || modPtr === 0) return;

    // find order and row for the given stepIndex
    let acc = 0;
    let targetOrder = 0;
    let targetRow = 0;
    const numOrders = lib._openmpt_module_get_num_orders(modPtr);
    for (let o = 0; o < numOrders; o++) {
      const m = patternMatricesRef.current[o];
      const rows = m ? m.numRows : lib._openmpt_module_get_pattern_num_rows(modPtr, lib._openmpt_module_get_order_pattern(modPtr, o));
      if (stepIndex < acc + rows) {
        targetOrder = o;
        targetRow = stepIndex - acc;
        break;
      }
      acc += rows;
    }

    try {
      lib._openmpt_module_set_position_order_row(modPtr, targetOrder, targetRow);
      // update UI state immediately
      setModuleInfo(prev => ({ ...prev, order: targetOrder, row: targetRow }));
      setSequencerCurrentRow(targetRow);
      setSequencerGlobalRow(stepIndex);
    } catch (e) {
      console.error('Failed to seek:', e);
    }
  };

  return { status, isReady, isPlaying, isModuleLoaded, moduleInfo, patternData, loadModule, play, stopMusic, sequencerMatrix, sequencerCurrentRow, sequencerGlobalRow, totalPatternRows, playbackSeconds, playbackRowFraction, channelStates, beatPhase, grooveAmount, kickTrigger, activeChannels, isLooping, setIsLooping, seekToStep, panValue, setPanValue };
}
