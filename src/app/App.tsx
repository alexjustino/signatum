import { useCallback, useEffect, useState } from 'react';

import { applyAccent, applyTheme, readStoredTheme, storeTheme } from '@/app/theme';
import { fetchAccentRamp } from '@/data/system';
import type { ThemeChoice } from '@/domain/settings';
import { AboutPage } from '@/features/about/AboutPage';
import { CreatePage } from '@/features/create/CreatePage';
import { DiagnosticsPage } from '@/features/diagnostics/DiagnosticsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { DESTINATION_LABELS, type Destination } from '@/features/shell/destinations';
import { Sidebar } from '@/features/shell/Sidebar';
import { TitleBar } from '@/features/shell/TitleBar';

/**
 * The window shell: title bar, navigation rail, content layer.
 *
 * The outer element is transparent so the Mica material Windows paints behind
 * the window shows through the chrome; the content region is the "layer" that
 * floats on it. That separation is the whole reason the application reads as
 * native rather than as a web page in a frame.
 */
export function App() {
  const [destination, setDestination] = useState<Destination>('create');

  // The theme is read once, before the first paint the user sees, and applied
  // here rather than in each screen. The accent ramp is re-read with it,
  // because the shade that reads on white does not read on near-black.
  const [theme, setTheme] = useState<ThemeChoice>(readStoredTheme);
  // The Create draft survives a trip to another screen: a person who goes to
  // Settings to switch the theme comes back to the link they typed.
  const [draft, setDraft] = useState('');
  useEffect(() => {
    applyTheme(theme);
    void fetchAccentRamp()
      .then(applyAccent)
      .catch(() => undefined);
  }, [theme]);

  const chooseTheme = useCallback((next: ThemeChoice) => {
    storeTheme(next);
    setTheme(next);
  }, []);

  const go = useCallback((next: Destination) => setDestination(next), []);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={destination} onNavigate={go} />
        <main
          tabIndex={0}
          aria-label={DESTINATION_LABELS[destination]}
          className="min-w-0 flex-1 overflow-y-auto bg-layer focus-visible:outline-none"
        >
          {destination === 'create' && <CreatePage draft={draft} onDraft={setDraft} />}
          {destination === 'diagnostics' && <DiagnosticsPage />}
          {destination === 'settings' && <SettingsPage theme={theme} onChoose={chooseTheme} />}
          {destination === 'about' && <AboutPage />}
        </main>
      </div>
    </div>
  );
}
