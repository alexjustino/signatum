import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseCsv, planBatch, reportCsv, type RowResult } from '../src/domain/batch';
import { DEFAULT_STYLE } from '../src/domain/scene';
import { DEFAULT_PRINT_SIZE } from '../src/domain/size';
import { startSession, type Session } from './session';

/**
 * F9's proof of done, against the real binary: a 200-row CSV produces one verified file per
 * row that can be made; a malformed row is reported by line and does not stop the rest; no
 * file is written outside the chosen folder, with traversal names in the fixture.
 *
 * Two doors, both real: the screen is driven through the paste box (a dialog cannot be driven),
 * and the host through the very command the screen calls, with a folder the suite owns. The
 * plan the host receives is the domain's — the same code the screen runs — and every file on
 * disk is read back by jsQR, a decoder that did not make it.
 */

const TOTAL = 200;
const BAD = 3;

/** Names that try to leave the folder, or that Windows reserves, or that a spreadsheet runs. */
const HOSTILE_NAMES = [
  '../../evil',
  '..\\evil',
  'C:\\evil',
  '\\\\server\\share\\evil',
  'CON',
  'a/b',
  'LPT1.png',
  '=HYPERLINK("https://evil.example")',
  '',
];

function csvFixture(): string {
  const lines = ['name,url'];
  for (let i = 0; i < TOTAL; i += 1) {
    if (i === 40) {
      lines.push('too,many,fields'); // wrong field count
      continue;
    }
    if (i === 41) {
      lines.push('Not a link,menu-without-scheme'); // the builder refuses it
      continue;
    }
    if (i === 42) {
      lines.push('Empty,'); // no url at all
      continue;
    }
    const name = HOSTILE_NAMES[i % HOSTILE_NAMES.length] ?? '';
    const quoted =
      name.includes(',') || name.includes('"') ? `"${name.replace(/"/g, '""')}"` : name;
    lines.push(`${quoted},https://example.com/row/${i}`);
  }
  return lines.join('\r\n') + '\r\n';
}

type InvokeResult<T> = T | { __error: string };

interface BatchReport {
  batch_id: string;
  written: number;
  refused: number;
  failed: number;
  skipped: number;
  results: Array<{ line: number; file: string; status: string; reason: string | null }>;
}

describe('batch', () => {
  let session: Session;
  let dir: string;
  let folder: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-batch-'));
    folder = path.join(dir, 'codes');
    await rm(folder, { recursive: true, force: true });
    await (await import('node:fs/promises')).mkdir(folder);
    session = await startSession();
  });

  afterAll(async () => {
    await session?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const invoke = <T>(command: string, args: Record<string, unknown>) =>
    session.driver.executeAsync<InvokeResult<T>>(
      'const [command, args, done] = arguments;' +
        'window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command, args],
    );

  /** Settings → the theme named, so a capture called light is light whatever Windows is set to. */
  async function theme(name: 'Light' | 'Dark' | 'Match Windows'): Promise<void> {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Settings"]')).click();
    await (
      await driver.findByXPath(`//button[@role="radio" and normalize-space(.)="${name}"]`)
    ).click();
    const expected = name === 'Match Windows' ? null : name.toLowerCase();
    await driver.waitFor(
      `the ${name} theme`,
      async () =>
        (await driver.execute<string | null>(
          'return document.documentElement.getAttribute("data-theme")',
        )) === expected,
    );
  }

  it('the screen plans the pasted rows, and names the ones it cannot make by line', async () => {
    const { driver } = session;
    await theme('Light');
    await (
      await driver.findByXPath('//nav[@aria-label="Main"]//button[normalize-space(.)="Batch"]')
    ).click();
    await driver.waitForElement('h1');
    await driver.execute(
      `const box = document.querySelector('textarea[aria-label="Rows"]');
       const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
       setter.call(box, ${JSON.stringify(csvFixture())});
       box.dispatchEvent(new Event('input', { bubbles: true }));`,
    );
    await driver.waitForText(`${TOTAL - BAD} of ${TOTAL} rows can be made.`);
    await driver.waitForElement('table[aria-label="Rows"]');
    const problems = await driver.findAll('ul[aria-label="Rows that cannot be made"] li');
    expect(problems).toHaveLength(BAD);
    const texts = await Promise.all(problems.map((p) => p.text()));
    // Lines are 1-based with the header on line 1: rows 40, 41 and 42 are lines 42, 43 and 44.
    expect(texts[0]).toMatch(/^Line 42:/);
    expect(texts[1]).toMatch(/^Line 43:/);
    expect(texts[2]).toMatch(/^Line 44:/);
    await session.screenshot('batch-plan');
  });

  it('keeps the pasted rows across a trip to Settings, and shows the plan in the dark theme', async () => {
    const { driver } = session;
    await theme('Dark');
    await (
      await driver.findByXPath('//nav[@aria-label="Main"]//button[normalize-space(.)="Batch"]')
    ).click();
    await driver.waitForElement('table[aria-label="Rows"]');
    await driver.waitForText(`${TOTAL - BAD} of ${TOTAL} rows can be made.`);
    await session.screenshot('batch-dark');
    await theme('Match Windows');
  });

  it('the host writes one verified file per row inside the folder, and nowhere else', async () => {
    const csv = parseCsv(csvFixture());
    const plan = planBatch(csv, { style: DEFAULT_STYLE, size: DEFAULT_PRINT_SIZE, logo: null });
    if (!('rows' in plan)) throw new Error('the fixture must plan');
    expect(plan.rows).toHaveLength(TOTAL - BAD);
    expect(plan.problems).toHaveLength(BAD);

    const parentBefore = (await readdir(dir)).sort();
    const report = await invoke<BatchReport>('run_batch', {
      folder,
      format: 'png',
      dpi: 300,
      rows: plan.rows.map((row) => ({
        line: row.line,
        file: row.file,
        svg: row.scene.svg,
        payload: row.payload,
        logo: null,
        pixel_size: row.pixelSize,
      })),
    });
    expect(report, JSON.stringify(report).slice(0, 400)).not.toHaveProperty('__error');
    const done = report as BatchReport;
    expect(done.written).toBe(TOTAL - BAD);
    expect(done.refused + done.failed + done.skipped).toBe(0);

    const files = (await readdir(folder)).filter((f) => f.endsWith('.png')).sort();
    expect(files).toHaveLength(TOTAL - BAD);
    // Nothing escaped the folder, and every name is one safe segment.
    expect((await readdir(dir)).sort()).toEqual(parentBefore);
    for (const f of files) {
      expect(f).not.toMatch(/[\\/]/);
      expect(f).not.toMatch(/^(con|prn|aux|nul|com\d|lpt\d)\./i);
      expect(f).toMatch(/^\d{3}-/);
    }
    // A sample of the files reads back as the exact link of its row.
    for (const row of plan.rows.filter((_, i) => i % 10 === 0)) {
      const bytes = await readFile(path.join(folder, `${row.file}.png`));
      const png = PNG.sync.read(bytes);
      expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, row.file).toBe(
        row.payload,
      );
    }

    // The report: the domain builds it with formulas neutralised; the host only writes it.
    const results: RowResult[] = done.results.map((r) => ({
      line: r.line,
      name: plan.rows.find((row) => row.line === r.line)?.name ?? '',
      file: r.file,
      status: r.status as RowResult['status'],
      reason: r.reason ?? '',
    }));
    const written = await invoke<{ path: string }>('write_batch_report', {
      folder,
      csv: reportCsv(results, plan.problems),
    });
    expect(written).not.toHaveProperty('__error');
    const text = await readFile((written as { path: string }).path, 'utf8');
    expect(text.startsWith('line,name,file,status,reason\r\n')).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
    expect(text).toContain('42,,,not made,');
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(1 + TOTAL);
  });

  it('run again into the same folder, nothing is replaced and every row says why', async () => {
    const csv = parseCsv(csvFixture());
    const plan = planBatch(csv, { style: DEFAULT_STYLE, size: DEFAULT_PRINT_SIZE, logo: null });
    if (!('rows' in plan)) throw new Error('the fixture must plan');
    const before = new Map<string, number>();
    for (const f of await readdir(folder)) {
      before.set(f, (await readFile(path.join(folder, f))).length);
    }

    const report = await invoke<BatchReport>('run_batch', {
      folder,
      format: 'png',
      dpi: 300,
      rows: plan.rows.slice(0, 20).map((row) => ({
        line: row.line,
        file: row.file,
        svg: row.scene.svg,
        payload: row.payload,
        logo: null,
        pixel_size: row.pixelSize,
      })),
    });
    expect(report).not.toHaveProperty('__error');
    const done = report as BatchReport;
    expect(done.written).toBe(0);
    expect(done.failed).toBe(20);
    expect(done.results[0]?.reason).toBe('A file with that name is already in the folder.');
    for (const [f, size] of before) {
      expect((await readFile(path.join(folder, f))).length, f).toBe(size);
    }
  });

  it('a second report never overwrites the first', async () => {
    const again = await invoke<{ path: string }>('write_batch_report', {
      folder,
      csv: 'line,name,file,status,reason\r\n',
    });
    expect(again).not.toHaveProperty('__error');
    expect(path.basename((again as { path: string }).path)).toBe('signatum-report-2.csv');
  });
});
