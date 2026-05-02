import React from 'react';
import { cn } from '../utils/cn';

export type PanelVariant = 'raised' | 'inset' | 'glass' | 'bezel';

interface PanelProps {
  children: React.ReactNode;
  variant?: PanelVariant;
  className?: string;
  title?: string;
  titleAccent?: boolean;
  glow?: boolean;
  compact?: boolean;
}

const VARIANT_CLASSES: Record<PanelVariant, string> = {
  raised: [
    'bg-panel-raised border border-panel',
    'shadow-panel',
  ].join(' '),
  inset: [
    'bg-panel-inset border border-panel',
    'shadow-panel-inset',
  ].join(' '),
  glass: [
    'bg-panel-raised/60 backdrop-blur-md border border-panel-strong',
    'shadow-panel',
  ].join(' '),
  bezel: [
    'bg-panel-base border-2 border-panel-strong',
    'shadow-panel',
    // Outer ridge
    'ring-1 ring-[var(--edge-highlight)]',
  ].join(' '),
};

/**
 * Reusable hardware-style panel that adapts to the active CSS-variable theme.
 * Wrap any UI zone (metadata, meters, playlist, etc.) with this component to
 * give it physical depth and a consistent "chassis" aesthetic.
 */
export const Panel: React.FC<PanelProps> = ({
  children,
  variant = 'raised',
  className,
  title,
  titleAccent = false,
  glow = false,
  compact = false,
}) => {
  return (
    <div
      className={cn(
        'rounded-xl overflow-hidden transition-shadow duration-300',
        VARIANT_CLASSES[variant],
        glow && 'shadow-glow',
        className,
      )}
    >
      {title && (
        <div
          className={cn(
            'px-3 py-1.5 border-b border-panel text-[10px] font-bold uppercase tracking-widest',
            'bg-panel-inset',
            titleAccent
              ? 'text-accent'
              : 'text-[var(--text-secondary)]',
          )}
        >
          {title}
        </div>
      )}
      <div className={compact ? 'p-2' : 'p-3'}>{children}</div>
    </div>
  );
};

export default Panel;
