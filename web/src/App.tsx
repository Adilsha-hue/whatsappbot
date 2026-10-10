import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useApp } from './store'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Workspace from './pages/Workspace'

export default function App() {
  const { user, ready } = useApp()

  if (!ready) {
    return (
      <div className="splash">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={user.role === 'superadmin' ? <Dashboard /> : <Navigate to="/app/inbox" />} />
        <Route path="/app/*" element={<Workspace />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}