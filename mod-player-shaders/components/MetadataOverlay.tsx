import React from 'react';
import { ModuleMetadata } from '../types';

interface MetadataOverlayProps {
  metadata: ModuleMetadata | null;
  currentOrder: number;
  isPlaying: boolean;
}

/**
 * Scrolling Metadata Overlay - Designed for placement in the center of round shaders
 * Displays scrolling song message, sample names, and track info
 */
export const MetadataOverlay: React.FC<MetadataOverlayProps> = ({
  metadata,

  isPlaying,
}) => {
  if (!metadata) return null;

  // Build scrolling content from various metadata sources
  const buildScrollText = (): string => {
    const parts: string[] = [];
    
    // Add title and artist
    if (metadata.title) {
      parts.push(`★ ${metadata.title} ★`);
    }
    if (metadata.artist) {
      parts.push(`by ${metadata.artist}`);
    }
    
    // Add format info
    parts.push(`[${metadata.format}]`);
    
    // Add sample names (these often contain personal notes/stories)
    const namedSamples = metadata.samples.filter(s => s && s.trim().length > 0);
    if (namedSamples.length > 0) {
      parts.push('');
      parts.push('═ SAMPLES ═');
      namedSamples.slice(0, 8).forEach((name, i) => {
        parts.push(`${i + 1}. ${name}`);
      });
      if (namedSamples.length > 8) {
        parts.push(`... and ${namedSamples.length - 8} more`);
      }
    }
    
    // Add instrument names
    const namedInstruments = metadata.instruments.filter(s => s && s.trim().length > 0);
    if (namedInstruments.length > 0) {
      parts.push('');
      parts.push('═ INSTRUMENTS ═');
      namedInstruments.slice(0, 6).forEach((name, i) => {
        parts.push(`${i + 1}. ${name}`);
      });
    }
    
    // Add comments/message (often contains greetings, stories, credits)
    if (metadata.comments) {
      parts.push('');
      parts.push('═ MESSAGE ═');
      // Split comments into lines and add them
      const commentLines = metadata.comments.split('\n').filter(l => l.trim());
      parts.push(...commentLines.slice(0, 20));
    }
    
    // Add separator and repeat
    parts.push('');
    parts.push('♪ ♫ ♪');
    
    return parts.join('\n');
  };

  const scrollText = buildScrollText();

  return (
    <div 
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{
        // Mask to circular area for round shaders
        maskImage: 'radial-gradient(circle at center, black 45%, transparent 65%)',
        WebkitMaskImage: 'radial-gradient(circle at center, black 45%, transparent 65%)',
      }}
    >
      <div className="w-48 h-48 flex items-center justify-center">
        <div 
          className="w-full h-full overflow-hidden rounded-full"
          style={{
            background: 'radial-gradient(circle at center, rgba(0,20,40,0.85) 0%, rgba(0,10,20,0.9) 70%, rgba(0,5,10,0.95) 100%)',
            boxShadow: 'inset 0 0 30px rgba(0,200,255,0.1), 0 0 20px rgba(0,0,0,0.5)',
            border: '1px solid rgba(0,200,255,0.2)',
          }}
        >
          {/* Scrolling text container */}
          <div 
            className="h-full px-4 py-3 overflow-hidden"
          >
            <pre
              className={`
                text-[9px] leading-tight font-mono text-center
                ${isPlaying ? 'animate-scroll-text' : ''}
              `}
              style={{
                color: 'rgba(200, 230, 255, 0.9)',
                textShadow: '0 0 8px rgba(0, 200, 255, 0.5)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                animation: isPlaying ? 'scroll-up 30s linear infinite' : 'none',
              }}
            >
              {scrollText}
            </pre>
          </div>
          
          {/* Gradient overlays for smooth fade */}
          <div 
            className="absolute top-0 left-0 right-0 h-6 pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(0,15,30,1) 0%, transparent 100%)',
            }}
          />
          <div 
            className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none"
            style={{
              background: 'linear-gradient(to top, rgba(0,15,30,1) 0%, transparent 100%)',
            }}
          />
        </div>
      </div>
      
      {/* CSS Animation for scrolling */}
      <style>{`
        @keyframes scroll-up {
          0% {
            transform: translateY(100%);
          }
          100% {
            transform: translateY(-100%);
          }
        }
      `}</style>
    </div>
  );
};

/**
 * Compact Metadata Badge - Shows current pattern/format in a small badge
 */
export const MetadataBadge: React.FC<{
  metadata: ModuleMetadata | null;
  currentOrder: number;
}> = ({ metadata, currentOrder }) => {
  if (!metadata) return null;
  
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
        {metadata.format}
      </span>
      <span className="text-gray-400">
        Order {currentOrder + 1}/{metadata.numOrders}
      </span>
    </div>
  );
};

export default MetadataOverlay;
