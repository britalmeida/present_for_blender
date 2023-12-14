import { defineConfig } from 'vite';
import { resolve } from 'path';
import path from 'path';
import glsl from 'vite-plugin-glsl';
import wasm from 'vite-plugin-wasm';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [glsl( {compress: true} ), wasm(),],
  build: {
    minify: false,
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: resolve(path.resolve(), 'src/shading.ts'),
      name: 'PresentRenderer',
      // the proper extensions will be added
      fileName: 'present-renderer',
    },
  },
})

