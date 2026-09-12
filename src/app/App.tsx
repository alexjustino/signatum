import { useCallback, useEffect, useState } from 'react';

import { applyAccent, applyTheme, readStoredTheme, storeTheme } from '@/app/theme';
import { fetchAccentRamp } from '@/data/system';
import { emptyForm, PAYLOAD_KINDS, type PayloadForm, type PayloadKind } from '@/domain/payload';
import { DEFAULT_STYLE, type Style } from '@/domain/scene';
import type { ThemeChoice } from '@/domain/settings';
import { DEFAULT_PRINT_SIZE, type PrintSize } from '@/domain/size';
import { AboutPage } from '@/features/about/AboutPage';
import { CreatePage } from '@/features/create/CreatePage';
import type { ChosenLogo } from '@/features/create/LogoCard';
import type { EclFloor } from '@/features/create/LookCard';
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
  // Settings to switch the theme comes back to what they typed. There is one
  // draft per kind rather than one draft, so trying the Wi-Fi form and coming
  // back to the link does not cost the link — switching kinds is a look, not a
  // decision, and a look must never destroy work.
  const [kind, setKind] = useState<PayloadKind>('link');
  const [drafts, setDrafts] = useState<Record<PayloadKind, PayloadForm>>(
    () =>
      Object.fromEntries(PAYLOAD_KINDS.map((each) => [each, emptyForm(each)])) as Record<
        PayloadKind,
        PayloadForm
      >,
  );
  // One logo for the editor, not one per kind: a person who chose their mark
  // chose it for their codes, so it survives a change of kind the way the theme
  // survives a change of screen.
  const [logo, setLogo] = useState<ChosenLogo | null>(null);
  // The look lives here for the same reason: a person who set their colours set
  // them for their codes, so they survive a change of kind and a trip to
  // Settings. It starts as the default one — black on white, square, with the
  // quiet zone the standard asks for.
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  // The error-correction floor sits beside the style rather than inside it: the
  // style is the scene's, and the scene draws a matrix it is never asked to
  // choose the level for. Absent is "let the engine decide".
  const [ecl, setEcl] = useState<EclFloor | undefined>(undefined);
  // The printed size lives here with the look and the logo, and for the same
  // reason: somebody who said their sticker is 25 mm at 300 dpi said it about
  // their codes, not about the link they happened to be typing. It starts at the
  // default — a 25 mm code at print resolution, which is 295 pixels square.
  const [printSize, setPrintSize] = useState<PrintSize>(DEFAULT_PRINT_SIZE);
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

  // A form knows its own kind, so the draft it replaces is the one it is.
  const editDraft = useCallback(
    (next: PayloadForm) => setDrafts((all) => ({ ...all, [next.kind]: next })),
    [],
  );

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
          {destination === 'create' && (
            <CreatePage
              kind={kind}
              onKind={setKind}
              form={drafts[kind]}
              onForm={editDraft}
              logo={logo}
              onLogo={setLogo}
              style={style}
              onStyle={setStyle}
              ecl={ecl}
              onEcl={setEcl}
              printSize={printSize}
              onPrintSize={setPrintSize}
            />
          )}
          {destination === 'diagnostics' && <DiagnosticsPage />}
          {destination === 'settings' && <SettingsPage theme={theme} onChoose={chooseTheme} />}
          {destination === 'about' && <AboutPage />}
        </main>
      </div>
    </div>
  );
}
