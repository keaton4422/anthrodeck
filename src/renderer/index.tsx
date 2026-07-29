import React from 'react';
import { createRoot } from 'react-dom/client';
import './global.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Drop the boot splash from index.html once React has actually painted. Using the render callback
// rather than a timer means the splash lasts exactly as long as the boot does — on a fast machine
// it is a blink, and on a cold Deck launch it stays up for the whole wait instead of handing over
// to a black screen partway through.
requestAnimationFrame(() => {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.style.transition = 'opacity 220ms ease-out';
  boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 240);
});
