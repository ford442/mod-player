import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultVideoPatternUrl } from '../../../utils/videoPatternSource';
import { usesVideoPatternTexture } from '../../../utils/shaderVersion';

export interface UseVideoPatternSourceParams {
  shaderFile: string;
  externalVideoSource: HTMLVideoElement | HTMLImageElement | null;
  isPlaying: boolean;
}

export function useVideoPatternSource(params: UseVideoPatternSourceParams) {
  const { shaderFile, externalVideoSource, isPlaying } = params;

  const needsDefaultVideo = usesVideoPatternTexture(shaderFile);
  const defaultVideoRef = useRef<HTMLVideoElement | null>(null);
  const [defaultVideoEl, setDefaultVideoEl] = useState<HTMLVideoElement | null>(null);

  const bindDefaultVideoRef = useCallback((el: HTMLVideoElement | null) => {
    defaultVideoRef.current = el;
    setDefaultVideoEl(el);
  }, []);

  useEffect(() => {
    const video = defaultVideoRef.current;
    if (!video || !needsDefaultVideo) return;
    video.src = defaultVideoPatternUrl();
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    void video.load();
  }, [needsDefaultVideo, shaderFile]);

  useEffect(() => {
    const video = defaultVideoRef.current;
    if (!video || !needsDefaultVideo) return;
    if (isPlaying) {
      void video.play().catch(() => { /* autoplay blocked until gesture */ });
    } else {
      video.pause();
    }
  }, [isPlaying, needsDefaultVideo]);

  const effectiveVideoSource =
    externalVideoSource ?? (needsDefaultVideo ? defaultVideoEl : null);

  return {
    needsDefaultVideo,
    bindDefaultVideoRef,
    effectiveVideoSource,
  };
}
