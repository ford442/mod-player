
import React from 'react';
import { ModuleInfo } from '../types';

interface InfoDisplayProps {
  moduleInfo: ModuleInfo;
}

export const InfoDisplay: React.FC<InfoDisplayProps> = ({ moduleInfo }) => {
  return (
    <div className="bg-[#111] p-3 rounded mb-4 text-xs font-mono text-green-400 border border-green-900/30 shadow-[inset_0_0_10px_rgba(0,0,0,0.8)]">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="overflow-hidden">
          <span className="text-green-700 uppercase">Title:</span>
          <span id="song-title" className="ml-2 uppercase tracking-wide">{moduleInfo.title || "NO TITLE"}</span>
        </div>
        <div>
          <span className="text-green-700 uppercase">Pos:</span>
          <span className="ml-2 text-white">ORD:<span id="current-order">{String(moduleInfo.order).padStart(2, '0')}</span></span>
          <span className="ml-3 text-white">ROW:<span id="current-row">{String(moduleInfo.row).padStart(2, '0')}</span></span>
        </div>
        <div>
          <span className="text-green-700 uppercase">BPM:</span>
          <span className="ml-2 text-white"><span id="current-bpm">{moduleInfo.bpm}</span></span>
        </div>
      </div>
    </div>
  );
};
