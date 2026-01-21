import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
  host: true,
  port: 6001,
  // allow requests using the public hostnames (prevents "Blocked request" errors)
  allowedHosts: ['ourcalendar.ca', 'www.ourcalendar.ca'],
    proxy: {
      '/api': 'http://localhost:5913'
    }
  }
})
