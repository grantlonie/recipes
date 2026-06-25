import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext } from 'react'

import { getAuthState, login, logout } from './api'
import type { AuthState } from './types'

interface AuthContextValue {
  auth: AuthState
  loginError: string | null
  loginPending: boolean
  logoutPending: boolean
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient()
  const authQuery = useQuery({
    queryFn: getAuthState,
    queryKey: ['auth'],
  })
  const loginMutation = useMutation({
    mutationFn: ({ password, username }: LoginInput) => login(username, password),
    onSuccess: authState => queryClient.setQueryData(['auth'], authState),
  })
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: authState => queryClient.setQueryData(['auth'], authState),
  })

  return (
    <AuthContext.Provider
      value={{
        auth: authQuery.data ?? { authenticated: false },
        loginError: loginMutation.error?.message ?? null,
        loginPending: loginMutation.isPending,
        logoutPending: logoutMutation.isPending,
        signIn: async (username, password) => {
          await loginMutation.mutateAsync({ password, username })
        },
        signOut: async () => {
          await logoutMutation.mutateAsync()
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return value
}

interface AuthProviderProps {
  children: ReactNode
}

interface LoginInput {
  password: string
  username: string
}
