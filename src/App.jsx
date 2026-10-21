import { Navigate, Route, Routes } from 'react-router-dom'
import Header from './components/Header'
import HomePage from './pages/HomePage'
import { LoginPage, SignupPage } from './pages/AuthPages'
import DashboardPage from './pages/DashboardPage'
import CatalogPage from './pages/CatalogPage'
import DevicesPage from './pages/DevicesPage'
import SettingsPage from './pages/SettingsPage'
import { ForgotPasswordPage, ResetPasswordPage, NotFoundPage } from './pages/PasswordPages'
import PublicListPage from './pages/PublicListPage'
import { useAuth } from './lib/auth'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <main className="page"><p>Loading…</p></main>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/dashboard"
          element={
            <Protected>
              <DashboardPage />
            </Protected>
          }
        />
        <Route
          path="/catalog"
          element={
            <Protected>
              <CatalogPage />
            </Protected>
          }
        />
        <Route
          path="/devices"
          element={
            <Protected>
              <DevicesPage />
            </Protected>
          }
        />
        <Route
          path="/settings"
          element={
            <Protected>
              <SettingsPage />
            </Protected>
          }
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* The gift-giver share page: public, read-only, no account needed. */}
        <Route path="/s/:slug" element={<PublicListPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <footer className="footer">
        Toy Library — fewer duplicate gifts, happier holidays.
      </footer>
    </>
  )
}
