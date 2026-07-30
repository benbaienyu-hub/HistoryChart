import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { knowledgeApiPlugin } from './server/knowledgeRoutes.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env into process.env so the server-side route can read
  // OPENAI_API_KEY. Only the server module ever touches it — it is not
  // exposed to the client (that would need a VITE_ prefix, which we avoid
  // deliberately so the key can't leak into the bundle).
  //
  // Note: a real environment variable wins over .env — that's Vite's
  // precedence, not a bug. Unset a stale shell export if .env seems ignored.
  Object.assign(process.env, loadEnv(mode, process.cwd(), 'OPENAI_'))

  return {
    plugins: [react(), knowledgeApiPlugin()],
    test: {
      // jsdom because most of what's worth testing here talks to localStorage
      // or document.documentElement (the theme store).
      environment: 'jsdom',
      include: ['test/**/*.test.js'],
      restoreMocks: true,
      setupFiles: ['./test/setup.js'],
    },
  }
})
