import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

function importPathFromDeepLink(deepLink: string): string | null {
  try {
    const parsed = new URL(deepLink)
    if (parsed.protocol !== 'gerecipes:') {
      return null
    }

    if (parsed.hostname !== 'import' && parsed.pathname !== '/import') {
      return null
    }

    const sharedUrl = parsed.searchParams.get('url')
    if (sharedUrl) {
      return `/import?url=${encodeURIComponent(sharedUrl)}`
    }

    const text = parsed.searchParams.get('text')
    if (text) {
      return `/import?text=${encodeURIComponent(text)}`
    }

    return '/import'
  } catch {
    return null
  }
}

export function registerNativeBridge(navigate: (path: string) => void): void {
  if (!Capacitor.isNativePlatform()) {
    return
  }

  void App.getLaunchUrl().then(result => {
    if (!result?.url) {
      return
    }

    const path = importPathFromDeepLink(result.url)
    if (path) {
      navigate(path)
    }
  })

  void App.addListener('appUrlOpen', event => {
    const path = importPathFromDeepLink(event.url)
    if (path) {
      navigate(path)
    }
  })
}
