import React, { useState } from 'react';
import { ModuleMetadata } from '../types';

interface MetadataPanelProps {
  metadata: ModuleMetadata | null;
  currentOrder: number;
  isPlaying: boolean;
}

type TabId = 'info' | 'instruments' | 'samples' | 'orders';

export const MetadataPanel: React.FC<MetadataPanelProps> = ({
  metadata,
  currentOrder,
  isPlaying,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('info');
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);

  if (!metadata) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
        No module loaded
      </div>
    );
  }

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'info', label: 'Info' },
    { id: 'instruments', label: 'Instruments', count: metadata.numInstruments },
    { id: 'samples', label: 'Samples', count: metadata.numSamples },
    { id: 'orders', label: 'Orders', count: metadata.numOrders },
  ];

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getFormatBadgeColor = (format: string): string => {
    const upper = format.toUpperCase();
    if (upper.includes('XM')) return 'bg-purple-600';
    if (upper.includes('IT')) return 'bg-blue-600';
    if (upper.includes('S3M')) return 'bg-green-600';
    if (upper.includes('MOD')) return 'bg-orange-600';
    return 'bg-gray-600';
  };

  return (
    <div className="w-full h-full flex flex-col bg-gray-900/90 rounded-lg border border-gray-700/50 overflow-hidden backdrop-blur-sm">
      {/* Header with Tabs */}
      <div className="flex border-b border-gray-700/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex-1 px-3 py-2 text-xs font-medium transition-all duration-200
              ${activeTab === tab.id 
                ? 'bg-cyan-500/20 text-cyan-400 border-b-2 border-cyan-400' 
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              }
            `}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className={`
                ml-1.5 px-1.5 py-0.5 rounded-full text-[10px]
                ${activeTab === tab.id ? 'bg-cyan-500/30' : 'bg-gray-700'}
              `}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {/* Info Tab */}
        {activeTab === 'info' && (
          <div className="h-full overflow-y-auto p-4 space-y-3">
            {/* Title */}
            <div className="text-center pb-3 border-b border-gray-700/50">
              <h3 className="text-cyan-400 font-bold text-sm truncate" title={metadata.title}>
                {metadata.title || 'Untitled Module'}
              </h3>            </div>

            {/* Format Badge */}
            <div className="flex justify-center">
              <span className={`${getFormatBadgeColor(metadata.format)} px-3 py-1 rounded-full text-xs font-bold text-white shadow-lg`}>
                {metadata.format || 'Unknown Format'}
              </span>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-800/50 p-2 rounded">
                <span className="text-gray-500 block">Artist</span>
                <span className="text-gray-200 truncate block" title={metadata.artist}>
                  {metadata.artist || 'Unknown'}
                </span>
              </div>
              <div className="bg-gray-800/50 p-2 rounded">
                <span className="text-gray-500 block">Tracker</span>
                <span className="text-gray-200 truncate block" title={metadata.tracker}>
                  {metadata.tracker || 'Unknown'}
                </span>
              </div>
              <div className="bg-gray-800/50 p-2 rounded">
                <span className="text-gray-500 block">Channels</span>
                <span className="text-cyan-400 font-mono">{metadata.numChannels}</span>
              </div>
              <div className="bg-gray-800/50 p-2 rounded">
                <span className="text-gray-500 block">Duration</span>
                <span className="text-cyan-400 font-mono">{formatTime(metadata.durationSeconds)}</span>
              </div>
              <div className="bg-gray-800/50 p-2 rounded">
                <span className="text-gray-500 block">Patterns</span>
                <span className="text-cyan-400 font-mono">{metadata.numPatterns}</span>
              </div>
              <div className="bg-gray-800/50 p-2 rounded">
                <span className="text-gray-500 block">BPM</span>
                <span className="text-cyan-400 font-mono">{Math.round(metadata.currentBpm)}</span>
              </div>
            </div>

            {/* Comments/Message */}
            {metadata.comments && (
              <div className="mt-3">
                <span className="text-gray-500 text-xs block mb-1">Message/Comments</span>
                <div className="bg-gray-800/30 border border-gray-700/30 rounded p-2 max-h-32 overflow-y-auto">
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                    {metadata.comments}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Instruments Tab */}
        {activeTab === 'instruments' && (
          <div className="h-full overflow-y-auto">
            <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-700/50 px-3 py-2 flex justify-between items-center">
              <span className="text-xs text-gray-500">{metadata.numInstruments} instrument(s)</span>
            </div>
            <div className="divide-y divide-gray-800">
              {metadata.instruments.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">No instruments in this module</div>
              ) : (
                metadata.instruments.map((name, idx) => (
                  <div 
                    key={idx}
                    className="px-3 py-2 hover:bg-gray-800/50 transition-colors flex items-center gap-3"
                  >
                    <span className="text-xs font-mono text-gray-500 w-8">{idx + 1:02d}</span>
                    <span className="text-sm text-gray-300 truncate flex-1" title={name}>
                      {name || `<no name>`}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Samples Tab */}
        {activeTab === 'samples' && (
          <div className="h-full overflow-y-auto">
            <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-700/50 px-3 py-2 flex justify-between items-center">
              <span className="text-xs text-gray-500">{metadata.numSamples} sample(s)</span>
            </div>
            <div className="divide-y divide-gray-800">
              {metadata.samples.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">No samples in this module</div>
              ) : (
                metadata.samples.map((name, idx) => (
                  <div 
                    key={idx}
                    className="px-3 py-2 hover:bg-gray-800/50 transition-colors flex items-center gap-3"
                  >
                    <span className="text-xs font-mono text-gray-500 w-8">{idx + 1:02d}</span>
                    <span className="text-sm text-gray-300 truncate flex-1" title={name}>
                      {name || `<no name>`}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Order List Tab */}
        {activeTab === 'orders' && (
          <div className="h-full overflow-y-auto">
            <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-700/50 px-3 py-2 flex justify-between items-center">
              <span className="text-xs text-gray-500">{metadata.numOrders} order(s)</span>
              <span className="text-xs text-cyan-400">Current: {currentOrder + 1}</span>
            </div>
            <div className="divide-y divide-gray-800">
              {metadata.orderList.map((patternIdx, orderIdx) => {
                const isCurrent = orderIdx === currentOrder;
                const isSelected = orderIdx === selectedOrder;
                
                return (
                  <div 
                    key={orderIdx}
                    onClick={() => setSelectedOrder(orderIdx)}
                    className={`
                      px-3 py-1.5 cursor-pointer transition-all flex items-center gap-3
                      ${isCurrent ? 'bg-cyan-500/20 border-l-2 border-cyan-400' : ''}
                      ${isSelected ? 'bg-gray-800' : 'hover:bg-gray-800/30'}
                    `}
                  >
                    <span className={`
                      text-xs font-mono w-8
                      ${isCurrent ? 'text-cyan-400 font-bold' : 'text-gray-500'}
                    `}>
                      {orderIdx + 1:02d}
                    </span>
                    <span className="text-xs text-gray-400">→</span>
                    <span className={`
                      text-sm font-mono
                      ${isCurrent ? 'text-white' : 'text-gray-400'}
                    `}>
                      Pattern {patternIdx}
                    </span>
                    {isCurrent && isPlaying && (
                      <span className="ml-auto w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    )}
                  </div>
                );
              })}
            </div>          </div>
        )}
      </div>
    </div>
  );
};

export default MetadataPanel;
