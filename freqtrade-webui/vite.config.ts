import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueDevTools from 'vite-plugin-vue-devtools'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    VueDevTools(),
    vue()
  ],
  base: './',
  server: {
    port: 3030,
    open: true
  },
  build: {
    sourcemap: true
  }
})
