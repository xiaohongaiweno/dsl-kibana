import { defineConfig } from 'vite'
import { createVuePlugin } from 'vite-plugin-vue2'

// Vue 2.5.x needs the community plugin; the official Vite plugin only supports Vue 2.7.
export default defineConfig({
  plugins: [createVuePlugin()],
})
