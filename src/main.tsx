import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installChunkReloadHandler } from './lib/chunkReload';
import './index.css';

// Register the kill-switch service worker to override any broken existing ones
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      // Force update to make sure we get the newest kill-switch
      registration.update();
    }).catch(err => {
      console.error('ServiceWorker registration failed: ', err);
    });
  });
}

installChunkReloadHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
