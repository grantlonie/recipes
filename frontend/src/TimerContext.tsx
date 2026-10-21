import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export type TimerStatus = 'finished' | 'idle' | 'paused' | 'running'

const STORAGE_KEY = 'recipes.timer'
export const DEFAULT_TIMER_MS = 5 * 60 * 1000
export const TIMER_MINUTE_MS = 60_000

interface StoredTimer {
  endsAt: number | null
  label: string
  remainingMs: number
  status: TimerStatus
}

interface TimerSnapshot {
  endsAt: number | null
  label: string
  remainingMs: number
  status: TimerStatus
}

interface TimerContextValue {
  adjust: (deltaMs: number) => void
  closeDialog: () => void
  dialogOpen: boolean
  label: string
  openDialog: () => void
  pause: () => void
  remainingMs: number
  resume: () => void
  setRemainingMs: (ms: number) => void
  start: (durationMs?: number, label?: string) => void
  status: TimerStatus
  stop: () => void
}

interface TimerProviderProps {
  children: ReactNode
}

const TimerContext = createContext<TimerContextValue | null>(null)

export function TimerProvider({ children }: TimerProviderProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<TimerSnapshot>(readInitialSnapshot)
  const [now, setNow] = useState(() => Date.now())
  const notificationTimeoutRef = useRef<number | null>(null)
  const finishedRef = useRef(snapshot.status === 'finished')
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  const { endsAt, label, remainingMs, status } = snapshot
  const displayRemainingMs =
    status === 'running' && endsAt != null ? Math.max(0, endsAt - now) : remainingMs

  const persist = useCallback((next: StoredTimer) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  const clearNotificationTimeout = useCallback(() => {
    if (notificationTimeoutRef.current != null) {
      window.clearTimeout(notificationTimeoutRef.current)
      notificationTimeoutRef.current = null
    }
  }, [])

  const applySnapshot = useCallback(
    (next: TimerSnapshot) => {
      setSnapshot(next)
      persist(next)
    },
    [persist]
  )

  const finishTimer = useCallback(
    (finishedLabel: string, announce: boolean) => {
      if (finishedRef.current) {
        return
      }
      finishedRef.current = true
      clearNotificationTimeout()
      applySnapshot({
        endsAt: null,
        label: finishedLabel,
        remainingMs: 0,
        status: 'finished',
      })
      setDialogOpen(true)
      if (announce) {
        playTimerJingle()
        void showTimerNotification(finishedLabel)
      }
    },
    [applySnapshot, clearNotificationTimeout]
  )

  useEffect(() => {
    clearNotificationTimeout()
    if (status !== 'running' || endsAt == null || endsAt <= Date.now()) {
      return
    }
    const timerLabel = label
    const delay = Math.max(0, endsAt - Date.now())
    notificationTimeoutRef.current = window.setTimeout(() => {
      finishTimer(timerLabel, true)
    }, delay)
    return () => clearNotificationTimeout()
  }, [clearNotificationTimeout, endsAt, finishTimer, label, status])

  useEffect(() => {
    function reconcile() {
      setNow(Date.now())
      const current = snapshotRef.current
      if (current.status !== 'running' || current.endsAt == null) {
        return
      }
      if (current.endsAt <= Date.now()) {
        finishTimer(current.label, true)
      }
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        reconcile()
      }
    }

    window.addEventListener('focus', reconcile)
    window.addEventListener('pageshow', reconcile)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('pageshow', reconcile)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [finishTimer])

  useEffect(() => {
    if (status !== 'running' || document.visibilityState !== 'visible') {
      return
    }
    const id = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      const latest = snapshotRef.current
      if (latest.status === 'running' && latest.endsAt != null && latest.endsAt <= current) {
        finishTimer(latest.label, true)
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [finishTimer, status])

  const start = useCallback(
    (durationMs?: number, nextLabel?: string) => {
      void requestNotificationPermission()
      finishedRef.current = false
      const current = snapshotRef.current
      const resolvedLabel = nextLabel !== undefined ? nextLabel.trim() : current.label
      const duration =
        durationMs != null && durationMs > 0
          ? durationMs
          : current.remainingMs > 0
            ? current.remainingMs
            : DEFAULT_TIMER_MS
      const deadline = Date.now() + duration
      applySnapshot({
        endsAt: deadline,
        label: resolvedLabel,
        remainingMs: duration,
        status: 'running',
      })
      setNow(Date.now())
    },
    [applySnapshot]
  )

  const pause = useCallback(() => {
    const current = snapshotRef.current
    if (current.status !== 'running' || current.endsAt == null) {
      return
    }
    const left = Math.max(0, current.endsAt - Date.now())
    applySnapshot({
      endsAt: null,
      label: current.label,
      remainingMs: left,
      status: 'paused',
    })
  }, [applySnapshot])

  const resume = useCallback(() => {
    const current = snapshotRef.current
    if (current.status !== 'paused' && current.status !== 'finished' && current.status !== 'idle') {
      return
    }
    start(current.remainingMs > 0 ? current.remainingMs : DEFAULT_TIMER_MS, current.label)
  }, [start])

  const stop = useCallback(() => {
    finishedRef.current = false
    applySnapshot({
      endsAt: null,
      label: '',
      remainingMs: DEFAULT_TIMER_MS,
      status: 'idle',
    })
  }, [applySnapshot])

  const adjust = useCallback(
    (deltaMs: number) => {
      const current = snapshotRef.current
      if (current.status === 'running' && current.endsAt != null) {
        const nextEndsAt = Math.max(Date.now(), current.endsAt + deltaMs)
        const left = Math.max(0, nextEndsAt - Date.now())
        if (left <= 0) {
          finishTimer(current.label, true)
          return
        }
        applySnapshot({
          endsAt: nextEndsAt,
          label: current.label,
          remainingMs: left,
          status: 'running',
        })
        return
      }

      const nextRemaining = Math.max(0, current.remainingMs + deltaMs)
      const nextStatus =
        current.status === 'finished' && nextRemaining > 0 ? 'paused' : current.status
      applySnapshot({
        endsAt: null,
        label: current.label,
        remainingMs: nextRemaining,
        status: nextStatus === 'running' ? 'paused' : nextStatus,
      })
    },
    [applySnapshot, finishTimer]
  )

  const setRemainingMs = useCallback(
    (ms: number) => {
      const nextRemaining = Math.max(0, Math.round(ms))
      const current = snapshotRef.current
      if (current.status === 'running') {
        if (nextRemaining <= 0) {
          finishTimer(current.label, true)
          return
        }
        const deadline = Date.now() + nextRemaining
        applySnapshot({
          endsAt: deadline,
          label: current.label,
          remainingMs: nextRemaining,
          status: 'running',
        })
        setNow(Date.now())
        return
      }

      if (current.status === 'finished' && nextRemaining > 0) {
        finishedRef.current = false
      }
      applySnapshot({
        endsAt: null,
        label: current.label,
        remainingMs: nextRemaining,
        status: current.status === 'finished' && nextRemaining > 0 ? 'paused' : current.status,
      })
    },
    [applySnapshot, finishTimer]
  )

  const openDialog = useCallback(() => setDialogOpen(true), [])
  const closeDialog = useCallback(() => setDialogOpen(false), [])

  const value = useMemo(
    () => ({
      adjust,
      closeDialog,
      dialogOpen,
      label,
      openDialog,
      pause,
      remainingMs: displayRemainingMs,
      resume,
      setRemainingMs,
      start,
      status,
      stop,
    }),
    [
      adjust,
      closeDialog,
      dialogOpen,
      displayRemainingMs,
      label,
      openDialog,
      pause,
      resume,
      setRemainingMs,
      start,
      status,
      stop,
    ]
  )

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>
}

export function useTimer() {
  const value = useContext(TimerContext)
  if (!value) {
    throw new Error('useTimer must be used within TimerProvider')
  }
  return value
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function readInitialSnapshot(): TimerSnapshot {
  const stored = readStoredTimer()
  if (!stored) {
    return {
      endsAt: null,
      label: '',
      remainingMs: DEFAULT_TIMER_MS,
      status: 'idle',
    }
  }
  if (stored.status === 'running' && stored.endsAt != null) {
    if (stored.endsAt <= Date.now()) {
      const finished: TimerSnapshot = {
        endsAt: null,
        label: stored.label,
        remainingMs: 0,
        status: 'finished',
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(finished))
      return finished
    }
    return {
      endsAt: stored.endsAt,
      label: stored.label,
      remainingMs: Math.max(0, stored.endsAt - Date.now()),
      status: 'running',
    }
  }
  return {
    endsAt: null,
    label: stored.label,
    remainingMs: stored.remainingMs,
    status: stored.status,
  }
}

function readStoredTimer(): StoredTimer | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<StoredTimer>
    if (
      parsed.status !== 'idle' &&
      parsed.status !== 'running' &&
      parsed.status !== 'paused' &&
      parsed.status !== 'finished'
    ) {
      return null
    }
    return {
      endsAt: typeof parsed.endsAt === 'number' ? parsed.endsAt : null,
      label: typeof parsed.label === 'string' ? parsed.label : '',
      remainingMs:
        typeof parsed.remainingMs === 'number' && parsed.remainingMs >= 0
          ? parsed.remainingMs
          : DEFAULT_TIMER_MS,
      status: parsed.status,
    }
  } catch {
    return null
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') {
    return
  }
  try {
    await Notification.requestPermission()
  } catch {
    // Permission prompts can fail in unsupported contexts.
  }
}

async function showTimerNotification(label: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return
  }
  const title = 'Timer done'
  const body = label.trim() ? label : 'Your cooking timer finished'
  const options: NotificationOptions = {
    body,
    icon: '/web-app-icon-192.png',
    tag: 'recipes-timer',
  }
  try {
    const registration = await navigator.serviceWorker?.ready
    if (registration?.active) {
      registration.active.postMessage({
        options,
        title,
        type: 'SHOW_NOTIFICATION',
      })
      return
    }
    if (registration?.showNotification) {
      await registration.showNotification(title, options)
      return
    }
  } catch {
    // Fall through to page Notification.
  }
  try {
    new Notification(title, options)
  } catch {
    // Notifications may be blocked after permission checks.
  }
}

function playTimerJingle() {
  try {
    const audioContext = new AudioContext()
    void audioContext.resume()
    const master = audioContext.createGain()
    master.gain.value = 0.14
    master.connect(audioContext.destination)

    // Bright kitchen-timer chime: two rising phrases with a closing ding.
    const melody: Array<{ frequency: number; start: number; duration: number }> = [
      { duration: 0.18, frequency: 784, start: 0 },
      { duration: 0.18, frequency: 988, start: 0.2 },
      { duration: 0.28, frequency: 1175, start: 0.4 },
      { duration: 0.16, frequency: 988, start: 0.72 },
      { duration: 0.16, frequency: 1175, start: 0.9 },
      { duration: 0.42, frequency: 1568, start: 1.1 },
      { duration: 0.14, frequency: 1319, start: 1.7 },
      { duration: 0.55, frequency: 1568, start: 1.9 },
    ]

    const startAt = audioContext.currentTime + 0.02
    for (const note of melody) {
      const oscillator = audioContext.createOscillator()
      const overtone = audioContext.createOscillator()
      const gain = audioContext.createGain()
      oscillator.type = 'triangle'
      overtone.type = 'sine'
      oscillator.frequency.value = note.frequency
      overtone.frequency.value = note.frequency * 2
      gain.gain.setValueAtTime(0.0001, startAt + note.start)
      gain.gain.exponentialRampToValueAtTime(1, startAt + note.start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + note.start + note.duration)
      oscillator.connect(gain)
      overtone.connect(gain)
      gain.connect(master)
      oscillator.start(startAt + note.start)
      overtone.start(startAt + note.start)
      oscillator.stop(startAt + note.start + note.duration + 0.05)
      overtone.stop(startAt + note.start + note.duration + 0.05)
    }

    window.setTimeout(() => {
      void audioContext.close()
    }, 2800)
  } catch {
    // Audio may be blocked without a gesture.
  }
}
