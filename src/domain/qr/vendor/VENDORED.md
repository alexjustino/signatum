# Vendored: Project Nayuki's QR Code generator (TypeScript)

|                 |                                                                                       |
| --------------- | ------------------------------------------------------------------------------------- |
| Upstream        | https://github.com/nayuki/QR-Code-generator — `typescript-javascript/qrcodegen.ts`    |
| Upstream commit | `8329a7108fc2` (2024-09-01)                                                           |
| Licence         | MIT — the header of `qrcodegen.ts` is the licence text; it is also listed in `NOTICE` |
| Upstream sha256 | `1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c`                    |

The file is kept **byte-for-byte** apart from the two patches below, which are the only lines
that differ from upstream. `vendor.test.ts` fails if anything else changes, so a bug fix goes
upstream first, or lands here as a numbered patch in this table.

| Patch | Where               | Why                                                                                                                                                                                    |
| ----- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | two lines prepended | `// @ts-nocheck` and `/* eslint-disable */`: upstream compiles under its own strict settings, but not under this project's `noUncheckedIndexedAccess`; the file is not ours to restyle |
| 2     | one line appended   | `export { qrcodegen };` — upstream is a script that declares a global namespace; a module boundary is needed to import it from `encode.ts`                                             |

Prettier is told to ignore the file (`.prettierignore`), because reformatting a vendored file is
a diff nobody can review against upstream.
