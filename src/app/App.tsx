import { useCallback, useEffect, useState } from 'react';

import { applyAccent, applyTheme, readStoredTheme, storeTheme } from '@/app/theme';
import type { SavedCode } from '@/data/library';
import { fetchAccentRamp } from '@/data/system';
import { emptyForm, PAYLOAD_KINDS, type PayloadForm, type PayloadKind } from '@/domain/payload';
import { DEFAULT_STYLE, type Style } from '@/domain/scene';
import type { ThemeChoice } from '@/domain/settings';
import { DEFAULT_PRINT_SIZE, type PrintSize } from '@/domain/size';
import { AboutPage } from '@/features/about/AboutPage';
import { BatchPage } from '@/features/batch/BatchPage';
import { CreatePage, type AttachedCode } from '@/features/create/CreatePage';
import type { ChosenLogo } from '@/features/create/LogoCard';
import type { EclFloor } from '@/features/create/LookCard';
import { resolveLogo } from '@/features/create/resolveLogo';
import { DiagnosticsPage } from '@/features/diagnostics/DiagnosticsPage';
import { LibraryPage } from '@/features/library/LibraryPage';
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
  // The batch's rows live here so that leaving the Batch screen and coming back keeps them.
  const [batchRows, setBatchRows] = useState('');
  // The saved code on screen, when there is one (F8): the row in the library the editor is
  // showing, either because it was opened from there or because it was just written there. It
  // lives here rather than in Create because everything that detaches it lives here.
  const [attached, setAttached] = useState<AttachedCode | null>(null);
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

  /**
   * Every change a person makes detaches the saved code.
   *
   * A saved code is a set of fields and the digest of the scene they made. The moment one of
   * those fields changes, what is on screen is no longer that code — so the verification rows
   * and the exports stop claiming it is, and the "reopened exactly as it was saved" sentence
   * goes away with it. It is one line in six setters rather than one clever effect, because a
   * rule about *what changed* belongs where the change happens.
   */
  const detach = useCallback(() => setAttached(null), []);

  // A form knows its own kind, so the draft it replaces is the one it is.
  const editDraft = useCallback(
    (next: PayloadForm) => {
      detach();
      setDrafts((all) => ({ ...all, [next.kind]: next }));
    },
    [detach],
  );

  const chooseKind = useCallback(
    (next: PayloadKind) => {
      detach();
      setKind(next);
    },
    [detach],
  );

  const chooseLogo = useCallback(
    (next: ChosenLogo | null) => {
      detach();
      setLogo(next);
    },
    [detach],
  );

  const chooseStyle = useCallback(
    (next: Style) => {
      detach();
      setStyle(next);
    },
    [detach],
  );

  const chooseEcl = useCallback(
    (next: EclFloor | undefined) => {
      detach();
      setEcl(next);
    },
    [detach],
  );

  const choosePrintSize = useCallback(
    (next: PrintSize) => {
      detach();
      setPrintSize(next);
    },
    [detach],
  );

  const go = useCallback((next: Destination) => setDestination(next), []);

  /**
   * Open a saved code: the fields, the look, the floor, the size and the logo go back where they
   * came from, and the editor is where the person lands — with the gate about to verify it again,
   * because a code that was verified yesterday has had nothing said about it today.
   *
   * The logo is the one part that has to be fetched: the library keeps a reference and the editor
   * needs the bytes. A reference the store can no longer answer is reported rather than dropped —
   * opening a code without the mark it was saved with would be a different code under the saved
   * one's name.
   */
  const openSavedCode = useCallback(
    async (saved: SavedCode): Promise<{ ok: true } | { ok: false; reason: string }> => {
      if (saved.logo !== null) {
        const resolved = await resolveLogo(saved.logo);
        if (!resolved.ok) return resolved;
        setLogo(resolved.logo);
      } else {
        setLogo(null);
      }
      setKind(saved.form.kind);
      setDrafts((all) => ({ ...all, [saved.form.kind]: saved.form }));
      setStyle(saved.style);
      setEcl(saved.eclFloor);
      setPrintSize(saved.size);
      setAttached({ id: saved.id, sceneSha256: saved.sceneSha256, opened: true });
      setDestination('create');
      return { ok: true };
    },
    [],
  );

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
              onKind={chooseKind}
              form={drafts[kind]}
              onForm={editDraft}
              logo={logo}
              onLogo={chooseLogo}
              style={style}
              onStyle={chooseStyle}
              ecl={ecl}
              onEcl={chooseEcl}
              printSize={printSize}
              onPrintSize={choosePrintSize}
              attached={attached}
              onAttach={setAttached}
            />
          )}
          {destination === 'library' && <LibraryPage onOpen={openSavedCode} />}
          {/* The batch runs on the look, the size and the logo the editor is holding: one set of
              decisions for the code on screen and the two hundred beside it. It is given them,
              never allowed to change them — a screen that quietly edited the editor's style
              would make the code a person approved and the batch they ran two different
              things. */}
          {destination === 'batch' && (
            <BatchPage
              style={style}
              size={printSize}
              eclFloor={ecl}
              logo={logo}
              rows={batchRows}
              onRows={setBatchRows}
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
