/**
 * The Rust version `Cargo.toml` declares is a promise: this compiler, or a newer one, builds the
 * product. It was 1.80 for a release while the tree Tauri brought in already needed 1.88, and
 * nothing noticed, because CI builds with the newest stable compiler and never with the declared
 * one (ADR-036).
 *
 * This gate makes the promise checkable without installing a second toolchain: it asks Cargo for
 * the dependency graph that builds on Windows, takes the highest `rust-version` any crate in it
 * declares, and fails when that is newer than ours. Declaring a newer version than the tree needs
 * is allowed; claiming an older one is not.
 *
 * Run by `npm run gates`, so a dependency bump that raises the floor says so before it merges.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.join(root, 'src-tauri', 'Cargo.toml');

/** `1.85`, `1.85.0` and `1.85.1` as three comparable numbers. */
function parts(version) {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return [major, minor, patch];
}

function newer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const text = readFileSync(manifest, 'utf-8');
// The `[package]` table's, and only that one.
const declared = text.slice(text.indexOf('[package]')).match(/^rust-version\s*=\s*"([^"]+)"/m)?.[1];
if (!declared) {
  console.error('src-tauri/Cargo.toml declares no rust-version.');
  process.exit(1);
}

const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--format-version',
      '1',
      '--locked',
      '--manifest-path',
      manifest,
      '--filter-platform',
      'x86_64-pc-windows-msvc',
    ],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  ),
);

const built = new Set(metadata.resolve.nodes.map((node) => node.id));
const above = metadata.packages
  .filter((pkg) => built.has(pkg.id) && pkg.rust_version && newer(pkg.rust_version, declared))
  .sort((a, b) => (newer(a.rust_version, b.rust_version) ? -1 : 1));

if (above.length > 0) {
  console.error(
    `src-tauri/Cargo.toml declares rust-version ${declared}, but these crates need more:`,
  );
  for (const pkg of above.slice(0, 10)) {
    console.error(`  ${pkg.name} ${pkg.version} needs ${pkg.rust_version}`);
  }
  if (above.length > 10) console.error(`  … and ${above.length - 10} more`);
  console.error('Raise it to the first, in a record of its own (ADR-036).');
  process.exit(1);
}

console.log(`rust-version ${declared} covers every crate in the Windows build (${built.size}).`);
