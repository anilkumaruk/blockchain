import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Without VITE_API_URL the app runs the in-browser mock, whose results are
  // simulated. A production deploy must never fall back to it silently.
  const env = loadEnv(mode, process.cwd(), '')
  if (process.env.VERCEL_ENV === 'production' && !env.VITE_API_URL) {
    throw new Error('VITE_API_URL is not set: a production deploy would run the simulated mock instead of the real server.')
  }
  return { plugins: [react(), tailwindcss()] }
})
