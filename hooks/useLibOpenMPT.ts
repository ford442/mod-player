import { useState, useEffect, useRef, useCallback } from 'react';
import type { LibOpenMPT, ModuleInfo, PatternMatrix, PatternCell } from '../types';

const SAMPLE_RATE = 44100;
// Buffer size of 4096 provides better audio quality and fewer buffer underruns
// Trade-off: ~93ms latency (4096/44100) vs ~23ms with 1024 samples
const BUFFER_SIZE = 4096;
const INITIAL_STATUS = "Hey! Loading library...";
const INITIAL_MODULE_INFO: ModuleInfo = { title: '...', order: 0, row: 0, bpm: 0, numChannels: 0 };
const DEFAULT_MODULE_URL = '4-mat_madness.mod';

// Construct the correct path ensuring it respects the Vite base URL
// const BASE_URL = import.meta.env.BASE_URL || './';
// Prepend BASE_URL so the worklet can be loaded from the correct base (Vite may set a sub-path)
const WORKLET_URL = ('./worklets/openmpt-processor.js').replace(/\/\//g, '/');

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
  const text