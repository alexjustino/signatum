import React from 'react';
import ReactDOM from 'react-dom/client';

import { Providers } from '@/app/providers';
import { Root } from '@/app/Root';
import { applyTheme, readStoredTheme } from '@/app/theme';
import '@/styles/global.css';

// The theme this machine last chose, applied before React renders anything.
//
// The record of truth is the settings table, and the window waits for it — but that wait is a
// host round trip, and a person who chose dark must not watch a white window during it. So the
// browser store keeps a copy of the choice purely as the guess this frame is painted with; the
// table answers a moment later and wins, and writes the copy back for the next start.
applyTheme(readStoredTheme());

const root = document.getElementById('root');
if (!root) throw new Error('the application root element is missing from index.html');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Providers>
      <Root />
    </Providers>
  </React.StrictMode>,
);
