import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * Accessibility (F11), and its proof of done from the specification:
 *
 *   "every screen opened for real, both themes, keyboard; axe green"
 *
 * axe-core is the industry's automated check — colour contrast, names on
 * controls, roles, heading order, landmark structure. It is injected into the
 * running window and run against each screen, in the light theme and the dark
 * one, because a contrast failure hides in exactly one of them. What axe
 * cannot judge — that the keyboard reaches everything, that focus is visible —
 * is checked here too, by tabbing through each screen and reading focus back.
 *
 * A violation is a defect this slice fixes, not a number to wave at: the test
 * prints the rule and the element for any it finds.
 */

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf-8');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; failureSummary: string }[];
}

const SCREENS = ['Create', 'Library', 'Batch', 'Read', 'Settings', 'Diagnostics', 'About'] as const;
const THEMES = ['Light', 'Dark'] as const;

async function go(session: Session, label: string): Promise<void> {
  await (
    await session.driver.findByXPath(`//nav[@aria-label="Main"]//*[normalize-space(.)="${label}"]`)
  ).click();
}

/**
 * Set the theme the way a person does — the Settings control — so the accent
 * tokens are re-applied for it. Forcing `data-theme` by hand would leave the
 * accent inline styles from the other theme, a mismatch no person ever sees.
 */
async function setTheme(session: Session, label: 'Light' | 'Dark'): Promise<void> {
  const { driver } = session;
  await go(session, 'Settings');
  await (
    await driver.findByXPath(`//button[@role="radio" and normalize-space(.)="${label}"]`)
  ).click();
  await driver.waitFor(`the ${label} theme`, async () =>
    (await driver.execute<string>(
      "return document.documentElement.getAttribute('data-theme') ?? 'system'",
    )) === label.toLowerCase()
      ? true
      : null,
  );
}

/** Run axe against the whole document and return the violations. */
async function violations(session: Session): Promise<AxeViolation[]> {
  await session.driver.execute(AXE_SOURCE);
  const result = await session.driver.executeAsync<{ violations: AxeViolation[] }>(
    `const done = arguments[arguments.length - 1];
     window.axe
       .run(document, {
         resultTypes: ['violations'],
         // Every rule axe knows, on: each screen has its own h1 and paints its own surfaces.
       })
       .then((r) => done({ violations: r.violations }))
       .catch((e) => done({ violations: [{ id: 'axe-failed', impact: 'serious', help: String(e), nodes: [] }] }));`,
  );
  return result.violations;
}

function report(screen: string, theme: string, found: AxeViolation[]): string {
  return found
    .map(
      (v) =>
        `\n  [${screen}/${theme}] ${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n` +
        v.nodes.map((n) => `    at ${n.target.join(' ')}\n    ${n.failureSummary}`).join('\n'),
    )
    .join('\n');
}

describe('accessibility', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    // A link on screen, so Create has its full furniture — the preview, the
    // scan-gate status, the export button — under axe, not an empty state.
    const link = await driver.waitForElement('input[aria-label="Link"]');
    await link.sendKeys('https://example.com/menu');
    await driver.waitForText('Opens example.com');
    await driver.waitForText('read it back byte for byte');
  }, 120_000);

  afterAll(async () => {
    await session?.stop();
  });

  for (const theme of THEMES) {
    for (const screen of SCREENS) {
      it(`${screen} has no axe violations in the ${theme} theme`, async () => {
        await setTheme(session, theme);
        await go(session, screen);
        // Let the theme's variables settle before the contrast pass reads them.
        await new Promise((resolve) => setTimeout(resolve, 150));
        const found = await violations(session);
        expect(found, report(screen, theme, found)).toEqual([]);
        await session.screenshot(`a11y-${screen.toLowerCase()}-${theme.toLowerCase()}`);
      }, 60_000);
    }
  }

  /** What the keyboard is on right now, as a short label, or 'BODY'. */
  async function focused(): Promise<string> {
    return session.driver.execute<string>(
      `const el = document.activeElement;
       if (!el || el === document.body) return 'BODY';
       const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || '';
       return el.tagName + ':' + label + (el.matches(':focus-visible') ? ':ring' : '');`,
    );
  }

  /** Real Tab presses through the WebDriver actions API, until a stop matches or the budget ends. */
  async function tabUntil(matches: (label: string) => boolean, budget = 60): Promise<string[]> {
    const path: string[] = [];
    for (let i = 0; i < budget; i += 1) {
      await session.driver.chord(Keys.TAB);
      const now = await focused();
      path.push(now);
      if (matches(now)) return path;
    }
    return path;
  }

  it('reaches the rail and the export button with real Tab presses, and focus shows', async () => {
    const { driver } = session;
    await setTheme(session, 'Light');
    await go(session, 'Create');
    await driver.waitForText('read it back byte for byte');
    // Start from nothing focused, as a person arriving at the window does.
    await driver.execute('document.activeElement && document.activeElement.blur();');

    const path = await tabUntil((label) => label.startsWith('BUTTON:Export PNG'));
    const text = path.join(' | ');
    expect(text, text).toContain('BUTTON:Library');
    expect(text, text).toContain('INPUT:Link');
    expect(path.at(-1), text).toMatch(/^BUTTON:Export PNG.*:ring$/);
    // Every stop shows its ring, and the rail comes before the work.
    expect(
      path.every((s) => s.endsWith(':ring')),
      text,
    ).toBe(true);
    expect(path.findIndex((s) => s.startsWith('BUTTON:Library'))).toBeLessThan(
      path.findIndex((s) => s.startsWith('INPUT:Link')),
    );
    await session.screenshot('a11y-keyboard');
  }, 60_000);

  it('opens a saved code from the library by keyboard alone', async () => {
    const { driver } = session;
    await go(session, 'Create');
    await driver.waitForText('read it back byte for byte');
    await (await driver.findByXPath('//button[normalize-space(.)="Save…"]')).click();
    const name = await driver.waitForElement('input[aria-label="Name"]');
    await name.clear();
    await name.sendKeys(' ');
    await name.sendKeys(Keys.BACKSPACE);
    await name.sendKeys('Menu');
    await (await driver.findByXPath('//button[normalize-space(.)="Save code"]')).click();
    await driver.waitForText('Saved as Menu');

    await go(session, 'Library');
    await driver.waitForElement('button[aria-label="Open Menu"]');
    await driver.execute('document.activeElement && document.activeElement.blur();');
    const path = await tabUntil((label) => label === 'BUTTON:Open Menu:ring');
    expect(path.at(-1), path.join(' | ')).toBe('BUTTON:Open Menu:ring');
    await driver.chord(Keys.ENTER);
    await driver.waitForText('Reopened exactly as it was saved.');
  }, 60_000);

  it('the confirm dialog takes focus, keeps it, and gives it back on Escape', async () => {
    const { driver } = session;
    await go(session, 'Library');
    await driver.waitForElement('button[aria-label="Delete Menu"]');
    await driver.execute('document.activeElement && document.activeElement.blur();');
    const path = await tabUntil((label) => label === 'BUTTON:Delete Menu:ring');
    expect(path.at(-1), path.join(' | ')).toBe('BUTTON:Delete Menu:ring');
    await driver.chord(Keys.ENTER);
    await driver.waitForElement('[role="dialog"]');
    const inside = () =>
      driver.execute<boolean>(
        'const d = document.querySelector("[role=dialog]"); return !!d && d.contains(document.activeElement);',
      );
    expect(await inside()).toBe(true);
    for (let i = 0; i < 6; i += 1) {
      await driver.chord(Keys.TAB);
      expect(await inside(), `after ${i + 1} tabs the focus left the dialog`).toBe(true);
    }
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor(
      'the dialog gone',
      async () =>
        (await driver.execute<boolean>(
          'return document.querySelector("[role=dialog]") === null',
        )) === true,
    );
    expect(await focused()).toMatch(/^BUTTON:Delete Menu/);
  }, 60_000);
});
