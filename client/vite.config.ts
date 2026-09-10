import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Bind to all interfaces (not just localhost) so other laptops on the LAN
  // can reach the dev server at this machine's IP address.
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
