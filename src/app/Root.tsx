import { App } from '@/app/App';
import { useSettings } from '@/data/hooks';
import { BUILT_IN_SETTINGS } from '@/data/settings';
import { TitleBar } from '@/features/shell/TitleBar';

/**
 * One bundle, one window. The indirection stays so a second window — a
 * review dialog, a run monitor — can be routed here later without touching
 * `main.tsx`.
 *
 * It is also where the window waits for what it was set to (F11). The editor starts from the
 * person's own defaults — their print size, their resolution, their quiet zone — and a screen
 * drawn from the built-in ones and corrected a moment later would show a size nobody chose and
 * then take it away. So the settings are read first and the shell is drawn with them, never
 * before: what a person sees on the first frame is what they will still see on the second.
 *
 * A workspace that cannot answer is not a reason to refuse to start. The built-in defaults
 * stand, the window opens, and the Settings screen is where that failure is reported — beside
 * the fields it is about, in the host's own sentence.
 */
export function Root() {
  const settings = useSettings();

  // The shape that is coming, and no spinner (DESIGN_SYSTEM §6): the chrome is already the
  // chrome, and only the content region is waiting. On a local table this is one frame.
  if (settings.isPending) {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-lg">
        <TitleBar />
        <div className="min-h-0 flex-1 bg-layer" />
      </div>
    );
  }

  return <App settings={settings.data ?? BUILT_IN_SETTINGS} />;
}
