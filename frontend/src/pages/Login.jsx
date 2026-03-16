import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../utils/api'
import { useAppStore } from '../store/appStore'
import toast from 'react-hot-toast'

export default function Login() {
  const navigate = useNavigate()
  const setAuth = useAppStore(s => s.setAuth)
  const [form, setForm] = useState({ username: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.username || !form.password) {
      setError('Please enter username and password')
      return
    }
    setLoading(true)
    try {
      const res = await login(form.username.trim(), form.password)
      const { token, user } = res.data
      // Persist in localStorage
      localStorage.setItem('hr_token', token)
      localStorage.setItem('hr_user', JSON.stringify(user))
      // Update store
      setAuth(user, token)
      toast.success(`Welcome, ${user.username}!`)
      navigate('/', { replace: true })
    } catch (err) {
      const msg = err.response?.data?.error || 'Login failed'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg mb-4">
            <span className="text-3xl">🏭</span>
          </div>
          <h1 className="text-2xl font-bold text-white">HR Intelligence Platform</h1>
          <p className="text-blue-300 text-sm mt-1">Indriyan Beverages / Asian Lakto Ind. Ltd.</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Username</label>
              <input
                type="text"
                className="input"
                placeholder="admin"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                autoComplete="username"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary justify-center py-2.5 text-base"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Signing in…
                </span>
              ) : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-6">
            Contact your administrator to reset your password
          </p>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          HR & Salary Processing System v1.0
        </p>
      </div>
    </div>
  )
}
