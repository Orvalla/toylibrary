import { Navigate, Route, Routes } from 'react-router-dom'
import Header from './components/Header'
import HomePage from './pages/HomePage'
import { LoginPage, SignupPage } from './pages/AuthPages'
import DashboardPage from './pages/DashboardPage'
import WelcomePage from './pages/WelcomePage'
import CatalogPage from './pages/CatalogPage'
import DevicesPage from './pages/DevicesPage'
import BooksPage from './pages/BooksPage'
import SettingsPage from './pages/SettingsPage'
import AdminPage from './pages/AdminPage'
import { ForgotPasswordPage, ResetPasswordPage, NotFoundPage } from './pages/PasswordPages'
import PublicListPage from './pages/PublicListPage'
import UnsubscribePage from './pages/UnsubscribePage'
import { PrivacyPage, TermsPage } from './pages/LegalPages'
import { useAuth } from './lib/auth'
import { shareSlugFromHost } from './lib/hostSlug'
import SupportWidget from './components/SupportWidget'
import { donateUrl } from './lib/donate'

// The footer line both layouts share. The Donate link renders
// only once the owner has set the PayPal link (lib/donate).
function FooterLine() {
  const url = donateUrl()
  return (
    <>
      Toy Library — fewer duplicate gifts, happier holidays. · <SupportWidget />
      {url && (
        <>
          {' · '}
          <a className="footer-link" href={url} target="_blank" rel="noreferrer">
            ❤️ Donate
          </a>
        </>
      )}
      {' · '}
      <a className="footer-link" href="https://toylibrary.store/privacy">
        Privacy
      </a>
      {' · '}
      <a className="footer-link" href="https://toylibrary.store/terms">
        Terms
      </a>
    </>
  )
}

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <main className="page"><p>Loading…</p></main>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  // On a family subdomain (<slug>.toylibrary.store) the gift
  // page is the whole site: share links ARE subdomains now, so
  // there's no path form and no site chrome to wander into.
  const hostSlug = shareSlugFromHost(window.location.hostname)
  if (hostSlug) {
    return (
      <>
        <Routes>
          <Route path="*" element={<PublicListPage slugOverride={hostSlug} />} />
        </Routes>
        <footer className="footer"><FooterLine /></footer>
      </>
    )
  }
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/welcome"
          element={
            <Protected>
              <WelcomePage />
            </Protected>
          }
        />
        <Route
          path="/dashboard"
          element={
            <Protected>
              <DashboardPage />
            </Protected>
          }
        />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/books" element={<BooksPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route
          path="/settings"
          element={
            <Protected>
              <SettingsPage />
            </Protected>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected>
              <AdminPage />
            </Protected>
          }
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* No share-page route here on purpose: gift pages live
            only on their family subdomain (see the hostSlug
            branch above), so a slug can never collide with a
            present or future page on this domain. */}
        {/* Gift-circle email unsubscribe: public, token-checked by RPC. */}
        <Route path="/unsubscribe" element={<UnsubscribePage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <footer className="footer"><FooterLine /></footer>
    </>
  )
}
