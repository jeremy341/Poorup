import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader' // 1. Import it

export default defineConfig({
  plugins: [
    vue(),
    svgLoader() // 2. Add it here
  ]
})