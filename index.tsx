import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { installGlobalFaultCapture } from './utils/faultReport';

// Before anything else runs: an error during startup is the one we most want a report of.
installGlobalFaultCapture();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
