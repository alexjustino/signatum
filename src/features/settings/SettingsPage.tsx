import { THEME_LABELS, THEMES, type ThemeChoice } from '@/domain/settings';
import { Card } from '@/ui/Card';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { announce } from '@/ui/announce';

/**
 * Settings.
 *
 * One card, because there is one thing to choose. The theme is held by the
 * window shell and applied there, so every screen changes at once and no screen
 * has to remember to; this page only offers the choice.
 */
export function SettingsPage({
  theme,
  onChoose,
}: {
  theme: ThemeChoice;
  onChoose: (next: ThemeChoice) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">Settings</h1>
        <p className="mt-1 text-body text-fg-secondary">
          Chosen here, kept on this machine, and nowhere else.
        </p>
      </header>

      <Card title="Appearance" description="Light, dark, or whatever Windows is set to.">
        <ChoiceGroup
          label="Theme"
          options={THEMES}
          value={theme}
          labels={THEME_LABELS}
          onChange={(next: ThemeChoice) => {
            onChoose(next);
            announce(`Theme set to ${THEME_LABELS[next].toLowerCase()}`);
          }}
        />
        <p className="mt-3 text-caption text-fg-tertiary">
          The theme colours the application, never the code. A code is previewed and exported in the
          colours it will be printed in, so what you see here is what a camera will read there.
        </p>
      </Card>
    </div>
  );
}
