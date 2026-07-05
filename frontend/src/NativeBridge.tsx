import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { registerNativeBridge } from './nativeBridge'

export function NativeBridge() {
  const navigate = useNavigate()

  useEffect(() => {
    registerNativeBridge(path => {
      navigate(path)
    })
  }, [navigate])

  return null
}
