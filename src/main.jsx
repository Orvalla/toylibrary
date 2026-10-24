import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import './styles.css'
import { startAnalytics } from './lib/analytics'

// First-party, privacy-light analytics (migration 0040):
// pageviews + a visibility heartbeat for session durations
// and the admin page's live view. Runs on the apex and on
// family subdomains alike (gift-page visits included).
startAnalytics()

// No redirect here: on a family subdomain
// (millers.toylibrary.store) App itself renders the gift page in
// place — the subdomain IS the share link.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
