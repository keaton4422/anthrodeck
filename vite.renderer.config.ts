import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// `root` points at src/renderer so index.html resolves there. The catch: Vite resolves build.outDir
// RELATIVE TO ROOT, so forge's default `.vite/renderer/main_window` landed inside
// src/renderer/.vite/renderer/main_window — while the packager only includes the project-root
// /.vite. The renderer built correctly on every release and was then left out of the package, so
// main called loadFile() on a path that did not exist and the app opened as a black window.
//
// outDir is therefore absolute and anchored to the project root, at the exact path main loads:
// main/index.js sits at .vite/build/main and does loadFile('../renderer/<name>/index.html'), which
// resolves to .vite/BUILD/renderer/<name>/index.html — note the `build` segment.
export default defineConfig({
  root: path.join(__dirname, 'src/renderer'),
  plugins: [react()],
  css: {
    postcss: path.join(__dirname, 'postcss.config.js'),
  },
  build: {
    outDir: path.join(__dirname, '.vite/build/renderer/main_window'),
    emptyOutDir: true,   // required, because outDir sits outside root
  },
});
