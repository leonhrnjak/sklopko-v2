/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the static build works from any path (GitHub Pages, a subfolder, file servers).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
