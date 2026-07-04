import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from './components/Button'
import { useAuth } from './AuthContext'
import { getSafeReturnTo } from './shareImport'

export function LoginPage() {
  const { auth, loginError, loginPending, signIn } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('editor')
  const returnTo = getSafeReturnTo(searchParams.get('returnTo')) ?? '/recipes/new'

  if (auth.authenticated) {
    return (
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
        <h1 className="text-2xl font-bold">Signed in</h1>
        <p className="mt-2 text-stone-600">You can create and edit recipes.</p>
        <Button className="mt-6" onClick={() => navigate(returnTo)}>
          Continue
        </Button>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
      <h1 className="text-2xl font-bold">Editor login</h1>
      <form className="mt-6 space-y-4" onSubmit={handleLogin}>
        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Username</span>
          <input
            className="mt-1 w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2"
            onChange={event => setUsername(event.target.value)}
            value={username}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-stone-700">Password</span>
          <input
            className="mt-1 w-full rounded-xl border border-orange-200 px-3 py-2 outline-none ring-orange-500 focus:ring-2"
            onChange={event => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        <Button className="w-full" disabled={loginPending} type="submit">
          {loginPending ? 'Signing in...' : 'Sign in'}
        </Button>
        {loginError ? <p className="text-sm text-red-700">{loginError}</p> : null}
      </form>
    </section>
  )

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await signIn(username, password)
    navigate(returnTo)
  }
}
