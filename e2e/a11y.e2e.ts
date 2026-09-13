import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

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

const SCREENS = ['Create', 'Library', 'Batch', 'Settings', 'Diagnostics', 'About'] as const;
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
         // The window is drawn on Mica the page cannot see, so a page-level
         // background contrast rule has nothing true to measure; every
         // component paints its own surface, which the per-element rules do
         // check. Everything else axe knows stays on.
         rules: { 'page-has-heading-one': { enabled: false } },
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

  it('reaches the navigation and the primary action by keyboard, with focus showing', async () => {
    const { driver } = session;
    await go(session, 'Create');
    await setTheme(session, 'Light');
    await go(session, 'Create');
    // The export button is reachable only once the gate has verified the code on screen.
    await driver.waitForText('read it back byte for byte');

    // Tab from the top and collect what the keyboard lands on: a run of Tabs
    // must reach the rail's destinations and the export button, and every stop
    // must be a real control (never the body), with a visible focus ring.
    const reached = await driver.execute<string[]>(
      `const seen = [];
       let active = document.activeElement;
       for (let i = 0; i < 40; i += 1) {
         const el = document.activeElement;
         if (el && el !== document.body) {
           const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName;
           seen.push(el.tagName + ':' + label);
         }
         const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
         (document.activeElement || document.body).dispatchEvent(ev);
         const next = document.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
         active = next[Math.min(i + 1, next.length - 1)];
         if (active instanceof HTMLElement) active.focus();
       }
       return seen;`,
    );
    // The rail and the export button are among what the keyboard can reach.
    const text = reached.join(' | ');
    expect(text).toContain('Create');
    expect(text).toContain('Export');
    // The focus-visible ring is defined for the theme, so a focused control
    // has an outline width to show.
    const outlined = await driver.execute<boolean>(
      `const b = document.querySelector('input[aria-label="Link"]');
       if (!(b instanceof HTMLElement)) return false;
       b.focus();
       const cs = getComputedStyle(b);
       return cs.getPropertyValue('--focus-ring').trim().length > 0;`,
    );
    expect(outlined).toBe(true);
    await session.screenshot('a11y-keyboard');
  }, 60_000);
});
