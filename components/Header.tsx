
import React from 'react';

interface HeaderProps {
  status: string;
}

export const Header: React.FC<HeaderProps> = ({ status }) => {
  return (
    <header className="mb-2 flex justify-between items-end border-b border-gray-700 pb-2 px-1">
      <h1 className="text-xl font-bold text-gray-200 tracking-wider font-mono">XASM-1 PLAYER</h1>
      <p id="status" className="text-xs text-yellow-400 font-mono">
        {status}
      </p>
    </header>
  );
};
