import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './auth'
import { Header } from './components/Header'
import { LoginPage } from './pages/LoginPage'
import { PaymentCancelPage, PaymentSuccessPage } from './pages/PaymentResultPage'
import { PortalPage } from './pages/PortalPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Header />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireAuth><PortalPage /></RequireAuth>} />
          <Route path="/payment/success" element={<RequireAuth><PaymentSuccessPage /></RequireAuth>} />
          <Route path="/payment/cancel" element={<RequireAuth><PaymentCancelPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
