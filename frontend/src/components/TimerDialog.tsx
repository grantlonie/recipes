import { MinusIcon, PauseIcon, PlayIcon, PlusIcon, StopIcon } from '@heroicons/react/24/outline'
import type { ChangeEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import { TIMER_MINUTE_MS, useTimer } from '../TimerContext'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { IconButton } from './IconButton'

const inputClassName =
  'w-20 rounded-xl border border-orange-200 bg-white px-2 py-2 text-center font-mono text-4xl font-semibold tabular-nums text-stone-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-200 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:focus:border-orange-500 dark:focus:ring-orange-900/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

export function TimerDialog() {
  const {
    adjust,
    closeDialog,
    dialogOpen,
    label,
    pause,
    remainingMs,
    resume,
    setRemainingMs,
    start,
    status,
    stop,
  } = useTimer()

  const canStart = status === 'idle' || status === 'paused' || status === 'finished'
  const canPause = status === 'running'
  const statusLabel =
    status === 'running'
      ? 'Running'
      : status === 'paused'
        ? 'Paused'
        : status === 'finished'
          ? 'Finished'
          : 'Ready'

  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const liveMinutes = Math.floor(totalSeconds / 60)
  const liveSeconds = totalSeconds % 60

  const [minutesValue, setMinutesValue] = useState<number | ''>(liveMinutes)
  const [secondsText, setSecondsText] = useState(padSeconds(liveSeconds))
  const minutesFocusedRef = useRef(false)
  const secondsFocusedRef = useRef(false)

  useEffect(() => {
    if (!minutesFocusedRef.current) {
      setMinutesValue(liveMinutes)
    }
    if (!secondsFocusedRef.current) {
      setSecondsText(padSeconds(liveSeconds))
    }
  }, [liveMinutes, liveSeconds])

  function handleStart() {
    if (status === 'idle' || status === 'finished') {
      start(remainingMs > 0 ? remainingMs : undefined, label)
      return
    }
    resume()
  }

  function commitTime(nextMinutes: number | '', nextSecondsText: string) {
    const minutes = clampInt(nextMinutes, 0, 999)
    const seconds = clampInt(Number.parseInt(nextSecondsText, 10), 0, 59)
    setMinutesValue(minutes)
    setSecondsText(padSeconds(seconds))
    setRemainingMs(minutes * TIMER_MINUTE_MS + seconds * 1000)
  }

  function handleMinutesChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value
    if (raw === '') {
      setMinutesValue('')
      return
    }
    setMinutesValue(clampInt(Number(raw), 0, 999))
  }

  function handleSecondsChange(event: ChangeEvent<HTMLInputElement>) {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 2)
    setSecondsText(digits)
  }

  const isFinished = status === 'finished'

  return (
    <Dialog onClose={closeDialog} open={dialogOpen} size="sm" title="Timer">
      <div className="flex flex-col items-center gap-4 py-2">
        {label.trim() ? (
          <p className="text-center text-sm font-medium text-stone-600 dark:text-stone-300">
            {label}
          </p>
        ) : null}
        {isFinished ? <TimerDoneClock /> : null}
        <div className="flex items-center gap-1">
          <label className="sr-only" htmlFor="timer-minutes">
            Minutes
          </label>
          <input
            className={inputClassName}
            id="timer-minutes"
            inputMode="numeric"
            max={999}
            min={0}
            onBlur={() => {
              minutesFocusedRef.current = false
              commitTime(minutesValue, secondsText)
            }}
            onChange={handleMinutesChange}
            onFocus={event => {
              minutesFocusedRef.current = true
              event.target.select()
            }}
            step={1}
            type="number"
            value={minutesValue}
          />
          <span aria-hidden="true" className="pb-1 font-mono text-4xl font-semibold text-stone-500">
            :
          </span>
          <label className="sr-only" htmlFor="timer-seconds">
            Seconds
          </label>
          <input
            className={inputClassName}
            id="timer-seconds"
            inputMode="numeric"
            maxLength={2}
            onBlur={() => {
              secondsFocusedRef.current = false
              commitTime(minutesValue, secondsText)
            }}
            onChange={handleSecondsChange}
            onFocus={event => {
              secondsFocusedRef.current = true
              event.target.select()
            }}
            pattern="[0-9]*"
            type="text"
            value={secondsText}
          />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          {statusLabel}
        </p>
        <div className="flex items-center gap-3">
          <IconButton
            aria-label="Subtract one minute"
            icon={<MinusIcon aria-hidden="true" className="h-5 w-5" />}
            onClick={() => adjust(-TIMER_MINUTE_MS)}
            tooltip={{ content: '−1 min' }}
            variant="secondary"
          />
          <IconButton
            aria-label="Add one minute"
            icon={<PlusIcon aria-hidden="true" className="h-5 w-5" />}
            onClick={() => adjust(TIMER_MINUTE_MS)}
            tooltip={{ content: '+1 min' }}
            variant="secondary"
          />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {canPause ? (
            <Button onClick={pause} type="button" variant="secondary">
              <span className="inline-flex items-center gap-2">
                <PauseIcon aria-hidden="true" className="h-4 w-4" />
                Pause
              </span>
            </Button>
          ) : null}
          {canStart ? (
            <Button onClick={handleStart} type="button">
              <span className="inline-flex items-center gap-2">
                <PlayIcon aria-hidden="true" className="h-4 w-4" />
                {status === 'paused' ? 'Resume' : 'Start'}
              </span>
            </Button>
          ) : null}
          <Button disabled={status === 'idle'} onClick={stop} type="button" variant="ghost">
            <span className="inline-flex items-center gap-2">
              <StopIcon aria-hidden="true" className="h-4 w-4" />
              Stop
            </span>
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function padSeconds(value: number) {
  return String(value).padStart(2, '0')
}

function clampInt(value: number | '', min: number, max: number) {
  if (value === '' || Number.isNaN(value)) {
    return min
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}

function TimerDoneClock() {
  return (
    <div aria-hidden="true" className="timer-done-clock" style={{ perspective: '900px' }}>
      <div className="timer-done-clock__ring" />
      <div className="timer-done-clock__face">
        <div className="timer-done-clock__hand" />
        <div className="timer-done-clock__hub" />
      </div>
      <div className="timer-done-clock__lid timer-done-clock__lid--left">
        <div className="timer-done-clock__lid-panel" />
      </div>
      <div className="timer-done-clock__lid timer-done-clock__lid--right">
        <div className="timer-done-clock__lid-panel" />
      </div>
    </div>
  )
}
