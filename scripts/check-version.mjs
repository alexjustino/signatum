/**
 * The version is one fact, declared in five files.
 *
 * `src-tauri/tauri.conf.json` is the source of truth — it is what the installer
 * and the running binary carry. `package.json`, its lockfile (in two places),
 * `src-tauri/Cargo.toml` and `Cargo.lock` mirror it. VERSIONING.md has always said a gate fails
 * if they disagree; this is that gate.
 *
 * The lockfile is here because it drifted the first time this was used in
 * anger: `package.json` was edited by hand, and npm's copy of the version stayed
 * a release behind until something looked.
 *
 * Run by `npm run gates`, so a bump that misses a file cannot reach a tag.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Semantic Versioning 2.0.0, with the pre-release and build forms we use. */
const SEMVER = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/;

function readJson(relative, key) {
  const file = path.join(root, relative);
  const value = JSON.parse(readFileSync(file, 'utf-8'))[key];
  return { file: relative, value };
}

function readCargo(relative) {
  const file = path.join(root, relative);
  const text = readFileSync(file, 'utf-8');
  // The first `version` after `[package]`, and only that one: the dependency
  // table below is full of versions that are not ours.
  const packageBlock = text.slice(text.indexOf('[package]'));
  const match = packageBlock.match(/^version\s*=\s*"([^"]+)"/m);
  return { file: relative, value: match?.[1] };
}

/** The lockfile's second copy of the version: `packages[""].version`, which `npm version` moves too. */
function readLockRoot(relative) {
  const file = path.join(root, relative);
  const value = JSON.parse(readFileSync(file, 'utf-8')).packages?.['']?.version;
  return { file: `${relative} (packages[""])`, value };
}

/** The crate's own entry in Cargo.lock, which a cargo command rewrites and a release must commit. */
function readCargoLock(relative) {
  const file = path.join(root, relative);
  const text = readFileSync(file, 'utf-8');
  const match = text.match(/\[\[package\]\]\nname = "signatum"\nversion = "([^"]+)"/);
  return { file: relative, value: match?.[1] };
}

const truth = readJson('src-tauri/tauri.conf.json', 'version');
const mirrors = [
  readJson('package.json', 'version'),
  readJson('package-lock.json', 'version'),
  readLockRoot('package-lock.json'),
  readCargo('src-tauri/Cargo.toml'),
  readCargoLock('src-tauri/Cargo.lock'),
];

const problems = [];

if (!truth.value) {
  problems.push(`${truth.file} declares no version`);
} else if (!SEMVER.test(truth.value)) {
  problems.push(`${truth.file}: "${truth.value}" is not a semantic version`);
}

for (const mirror of mirrors) {
  if (mirror.value !== truth.value) {
    problems.push(`${mirror.file}: "${mirror.value}" — expected "${truth.value}"`);
  }
}

if (problems.length > 0) {
  console.error('The version is not one fact:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\nThe source of truth is ${truth.file}. Bring the others to it.`);
  process.exit(1);
}

console.log(`version ${truth.value}, agreed by ${mirrors.length + 1} files`);
