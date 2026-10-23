import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { shareSlugFromHost } from './lib/hostSlug'
import './styles.css'

// millers.toylibrary.store -> toylibrary.store/millers, before the
// app boots, so every visitor lands on the one canonical page.
const hostSlug = shareSlugFromHost(window.location.hostname)
if (hostSlug) {
  window.location.replace(`https://toylibrary.store/${hostSlug}`)
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
