import { defineConfig } from 'vite';

/**
 * Builds the domain's encoder as one plain ES module so that `scripts/corpus.mjs` can call it
 * from Node without a bundler in the loop. The output lands under `src-tauri/target/`, which is
 * never committed: the corpus is generated, and so is the encoder it is generated with.
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/domain/qr/encode.ts',
      formats: ['es'],
      fileName: () => 'encoder.mjs',
    },
    outDir: 'src-tauri/target/corpus',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
  },
  logLevel: 'warn',
});
