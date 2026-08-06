import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'reactflow/dist/style.css'
import './index.css'
import App from './App.jsx'
import { migrateLegacyStorage } from './lib/migrate.js'

// Must happen before the first render, since App reads the session during its
// initial state setup.
migrateLegacyStorage()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
