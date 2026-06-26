const CACHE_NAME = 'recipes-app-v4'
const APP_SHELL = [
  '/',
  '/apple-touch-icon.png',
  '/favicon-32x32.png',
  '/favicon.ico',
  '/logo.png',
  '/manifest.webmanifest',
  '/web-app-icon-192.png',
  '/web-app-icon-512.png',
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
      )
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET') {
    return
  }

  if (url.pathname.startsWith('/api/')) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put('/', copy))
        }
        return response
      }).catch(() => caches.match(event.request).then(cached => cached || caches.match('/')))
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        return cached
      }
      return fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
        }
        return response
      })
    })
  )
})
