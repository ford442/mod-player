
import React from 'react';

interface HeaderProps {
  status: string;
  isModuleLoaded?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ status, isModuleLoaded = false }) => {
  const displayStatus = isModuleLoaded ? status : `${status} · Press ? for shortcuts`;

  return (
    <header className="mb-6">
      <h1 className="text-3xl font-bold text-white mb-2">libopenmpt Note Viewer</h1>
      <p id="status" className="text-lg text-yellow-400 min-h-[28px]">
        {displayStatus}
      </p>
    </header>
  );
};
