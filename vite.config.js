import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { knowledgeApiPlugin } from './server/knowledgeRoutes.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env into process.env so the server-side Claude route can read
  // ANTHROPIC_API_KEY. Only the server module ever touches it — it is not
  // exposed to the client (that would need a VITE_ prefix, which we avoid
  // deliberately so the key can't leak into the bundle).
  Object.assign(process.env, loadEnv(mode, process.cwd(), 'ANTHROPIC_'))

  return {
    plugins: [react(), knowledgeApiPlugin()],
  }
})
