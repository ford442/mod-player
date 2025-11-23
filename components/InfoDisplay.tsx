
import React from 'react';
import { ModuleInfo } from '../types';

interface InfoDisplayProps {
  moduleInfo: ModuleInfo;
}

export const InfoDisplay: React.FC<InfoDisplayProps> = ({ moduleInfo }) => {
  return (
    <section className="bg-gray-800 p-4 rounded-lg shadow-lg mb-6 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <span className="font-bold text-gray-400">Title:</span>
          <span id="song-title" className="ml-2 truncate">{moduleInfo.title}</span>
        </div>
        <div>
          <span className="font-bold text-gray-400">Position:</span>
          <span className="ml-2">Order: <span id="current-order" className="font-semibold text-white">{String(moduleInfo.order).padStart(2, '0')}</span></span>
          <span className="ml-4">Row: <span id="current-row" className="font-semibold text-white">{String(moduleInfo.row).padStart(2, '0')}</span></span>
        </div>
        <div>
          <span className="font-bold text-gray-400">Tempo:</span>
          <span className="ml-2"><span id="current-bpm" className="font-semibold text-white">{moduleInfo.bpm}</span> BPM</span>
        </div>
      </div>
    </section>
  );
};
