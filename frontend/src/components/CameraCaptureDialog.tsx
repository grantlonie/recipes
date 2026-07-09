import { useEffect, useRef, useState } from 'react'

import { Button } from './Button'
import { Dialog } from './Dialog'

interface CameraCaptureDialogProps {
  onCapture: (file: File) => void
  onClose: () => void
  open: boolean
  title?: string
}

export function isCameraCaptureSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

export function CameraCaptureDialog({
  onCapture,
  onClose,
  open,
  title = 'Take photo',
}: CameraCaptureDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) {
      stopStream()
      setError(null)
      setReady(false)
      return
    }

    let cancelled = false

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera is not supported in this browser.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        streamRef.current = stream
        const video = videoRef.current
        if (!video) {
          return
        }

        video.srcObject = stream
        await video.play()
        setReady(true)
        setError(null)
      } catch {
        if (!cancelled) {
          setError('Could not access the camera. Check permissions or choose a file instead.')
        }
      }
    }

    void startCamera()

    return () => {
      cancelled = true
      stopStream()
    }
  }, [open])

  function stopStream() {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  function handleClose() {
    stopStream()
    onClose()
  }

  function handleCapture() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    context.drawImage(video, 0, 0)
    canvas.toBlob(
      blob => {
        if (!blob) {
          setError('Could not capture photo.')
          return
        }
        const file = new File([blob], `recipe-photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
        stopStream()
        onCapture(file)
      },
      'image/jpeg',
      0.92
    )
  }

  return (
    <Dialog className="max-w-lg" labelledBy="camera-capture-dialog-title" open={open}>
      <h2
        className="text-xl font-bold text-stone-900 dark:text-stone-100"
        id="camera-capture-dialog-title"
      >
        {title}
      </h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Position the recipe in view, then capture the photo.
      </p>

      <div className="mt-4 overflow-hidden rounded-2xl bg-stone-900">
        {error ? (
          <div className="flex aspect-[4/3] items-center justify-center px-6 text-center text-sm text-stone-300">
            {error}
          </div>
        ) : (
          <video
            autoPlay
            className="aspect-[4/3] w-full object-cover"
            muted
            playsInline
            ref={videoRef}
          />
        )}
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button onClick={handleClose} type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={!ready || Boolean(error)} onClick={handleCapture} type="button">
          Capture photo
        </Button>
      </div>
    </Dialog>
  )
}
