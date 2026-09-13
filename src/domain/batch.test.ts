import { describe, expect, it } from 'vitest';

import {
  MAX_BATCH_ROWS,
  csvCell,
  fileNameFor,
  formOfRow,
  kindOfHeader,
  parseCsv,
  planBatch,
  reportCsv,
  sanitiseFileStem,
} from './batch';
import { DEFAULT_STYLE } from './scene';
import { DEFAULT_PRINT_SIZE } from './size';

const LOOK = { style: DEFAULT_STYLE, size: DEFAULT_PRINT_SIZE, logo: null };

describe('parseCsv', () => {
  it('reads RFC 4180: quotes, doubled quotes, CRLF, a BOM, a trailing newline', () => {
    const csv =
      '\uFEFFname,url\r\n"Menu, main","https://example.com/menu"\r\n"Say ""hi""",https://example.org/\r\n';
    const parsed = parseCsv(csv);
    expect(parsed.header).toEqual(['name', 'url']);
    expect(parsed.rows.map((r) => r.fields)).toEqual([
      ['Menu, main', 'https://example.com/menu'],
      ['Say "hi"', 'https://example.org/'],
    ]);
    expect(parsed.rows.map((r) => r.line)).toEqual([2, 3]);
    expect(parsed.problems).toEqual([]);
  });

  it('reports a row with the wrong number of fields by line, and keeps the rest', () => {
    const parsed = parseCsv(
      'url\nhttps://a.example/\nhttps://b.example/,extra\nhttps://c.example/\n',
    );
    expect(parsed.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(parsed.problems).toEqual([
      { line: 3, reason: 'This row has 2 fields; the first line names 1.' },
    ]);
  });

  it('counts lines inside quoted fields so the report points at the right line', () => {
    const parsed = parseCsv('name,url\n"two\nlines",https://a.example/\nbad\n');
    expect(parsed.rows[0]?.line).toBe(2);
    expect(parsed.problems).toEqual([
      { line: 4, reason: 'This row has 1 fields; the first line names 2.' },
    ]);
  });

  it('refuses an unclosed quote, an empty file, and caps the rows', () => {
    expect(parseCsv('url\n"https://a.example/').problems[0]?.reason).toContain('never closed');
    expect(parseCsv('').problems[0]?.reason).toBe('The file is empty.');
    const many = 'url\n' + 'https://a.example/\n'.repeat(MAX_BATCH_ROWS + 5);
    const parsed = parseCsv(many);
    expect(parsed.rows).toHaveLength(MAX_BATCH_ROWS);
    expect(parsed.problems[0]?.reason).toContain(`at most ${MAX_BATCH_ROWS} rows`);
  });
});

describe('kindOfHeader and formOfRow', () => {
  it('decides by the columns, and says what it needs otherwise', () => {
    expect(kindOfHeader(['name', 'url'])).toEqual({ ok: true, kind: 'link' });
    expect(kindOfHeader(['given_name', 'family_name', 'email'])).toEqual({
      ok: true,
      kind: 'contact',
    });
    expect(kindOfHeader(['title', 'link'])).toMatchObject({ ok: false });
  });

  it('maps the contact columns, with organisation spelt either way', () => {
    const form = formOfRow(
      'contact',
      ['given_name', 'organization', 'website'],
      ['Ana', 'Example Ltd', 'https://example.com'],
    );
    expect(form).toMatchObject({
      kind: 'contact',
      givenName: 'Ana',
      organisation: 'Example Ltd',
      url: 'https://example.com',
      format: 'vcard3',
    });
  });
});

describe('file names', () => {
  it('sanitises what a cell says into one safe path segment', () => {
    // The leading dots go; the dots inside are just dots, with no separator to give them meaning.
    expect(sanitiseFileStem('../../evil')).toBe('-..-evil');
    expect(sanitiseFileStem('..\\evil')).toBe('-evil');
    expect(sanitiseFileStem('C:\\x')).toBe('C--x');
    expect(sanitiseFileStem('\\\\server\\share')).toBe('--server-share');
    expect(sanitiseFileStem('a/b')).toBe('a-b');
    expect(sanitiseFileStem('CON')).toBe('code-CON');
    expect(sanitiseFileStem('con.txt')).toBe('code-con.txt');
    expect(sanitiseFileStem('COM3')).toBe('code-COM3');
    expect(sanitiseFileStem('conin$')).toBe('code-conin$');
    expect(sanitiseFileStem('  . . ')).toBe('code');
    expect(sanitiseFileStem('..')).toBe('code');
    expect(sanitiseFileStem('')).toBe('code');
    expect(sanitiseFileStem('x'.repeat(200))).toHaveLength(80);
    expect(sanitiseFileStem('Café ✅ menu')).toBe('Café ✅ menu');
    expect(sanitiseFileStem('a\u0000b\u001fc')).toBe('abc');
  });

  it('never produces a separator, a traversal or a reserved name', () => {
    for (const raw of [
      '../../evil',
      '..\\evil',
      'C:\\x',
      '\\\\server\\share',
      'CON',
      'nul',
      'a/b',
      '.',
      '..',
      'x:y',
      'LPT9.png',
    ]) {
      const stem = sanitiseFileStem(raw);
      expect(stem).not.toMatch(/[\\/]/);
      expect(stem).not.toBe('.');
      expect(stem).not.toBe('..');
      expect(stem.length).toBeGreaterThan(0);
      expect(['con', 'nul', 'lpt9']).not.toContain(stem.split('.')[0]?.toLowerCase());
    }
  });

  it('prefixes the row and keeps names unique within the batch', () => {
    const taken = new Set<string>();
    expect(fileNameFor(0, 'Ana', taken)).toBe('001-Ana');
    expect(fileNameFor(1, 'Ana', taken)).toBe('002-Ana');
    expect(fileNameFor(0, 'ana', taken)).toBe('001-ana-2');
    expect(fileNameFor(6, 'Ana Souza', taken)).toBe('007-Ana Souza');
  });
});

describe('planBatch', () => {
  it('plans every row through the Create pipeline and reports the ones it cannot make', () => {
    const csv = parseCsv(
      'name,url\nMenu,https://example.com/menu\nBad,not-a-link\n,https://example.org/\n',
    );
    const plan = planBatch(csv, LOOK);
    expect('rows' in plan).toBe(true);
    if (!('rows' in plan)) return;
    expect(plan.kind).toBe('link');
    expect(plan.rows.map((r) => [r.line, r.file, r.payload])).toEqual([
      [2, '001-Menu', 'https://example.com/menu'],
      [4, '003-example.org', 'https://example.org/'],
    ]);
    expect(plan.problems).toEqual([{ line: 3, reason: expect.stringContaining('link') }]);
    expect(plan.rows[0]?.scene.svg).toContain('<svg');
    expect(plan.rows[0]?.pixelSize).toBe(295);
  });

  it('refuses a header it cannot read, with the sentence', () => {
    const plan = planBatch(parseCsv('a,b\n1,2\n'), LOOK);
    expect(plan).toMatchObject({ ok: false, reason: expect.stringContaining('"url"') });
  });

  it('plans contacts and reports a card without a name by line', () => {
    const csv = parseCsv(
      'given_name,family_name,email\nAna,Souza,ana@example.com\n,,nobody@example.com\n',
    );
    const plan = planBatch(csv, LOOK);
    if (!('rows' in plan)) throw new Error('expected a plan');
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.payload).toContain('BEGIN:VCARD');
    expect(plan.problems[0]).toMatchObject({ line: 3, reason: expect.stringContaining('name') });
  });
});

describe('the report', () => {
  it('neutralises formulas and escapes CSV', () => {
    expect(csvCell('=HYPERLINK("https://evil.example")')).toBe(
      `"'=HYPERLINK(""https://evil.example"")"`,
    );
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line\r\nbreak')).toBe('"line\nbreak"');
  });

  it('writes one line per row and per problem, in line order, with CRLF', () => {
    const report = reportCsv(
      [
        { line: 2, name: '=Menu', file: '001-Menu', status: 'written', reason: '' },
        {
          line: 4,
          name: 'Late',
          file: '003-Late',
          status: 'refused',
          reason: 'The decoder found no code.',
        },
      ],
      [{ line: 3, reason: 'That is not a link.' }],
    );
    expect(report.split('\r\n')).toEqual([
      'line,name,file,status,reason',
      "2,'=Menu,001-Menu,written,",
      '3,,,not made,That is not a link.',
      '4,Late,003-Late,refused,The decoder found no code.',
      '',
    ]);
  });
});
