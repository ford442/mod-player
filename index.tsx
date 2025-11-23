
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// FIX: Remove CSS import from JS, as it's not supported in a no-build environment.
// import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
