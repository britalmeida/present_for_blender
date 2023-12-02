import { defineConfig } from 'vite';
import { resolve } from 'path'
import glsl from 'vite-plugin-glsl';


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [glsl( {compress: true} )],
  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: resolve(__dirname, 'src/shading.ts'),
      name: 'PresentRenderer',
      // the proper extensions will be added
      fileName: 'present-renderer',
    },
  },
})
