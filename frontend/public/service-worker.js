const CACHE_NAME = 'recipes-app-v8'
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

self.addEventListener('message', event => {
  const data = event.data
  if (!data || data.type !== 'SHOW_NOTIFICATION') {
    return
  }
  const title = typeof data.title === 'string' ? data.title : 'Timer done'
  const options = data.options && typeof data.options === 'object' ? data.options : {}
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/')
      }
      return undefined
    })
  )
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET') {
    return
  }

  if (url.pathname.startsWith('/api/')) {
    return
  }

  if (url.origin !== self.location.origin && event.request.destination === 'image') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) {
            return cached
          }
          return fetch(event.request).then(response => {
            if (response.ok) {
              cache.put(event.request, response.clone())
            }
            return response
          })
        })
      )
    )
    return
  }

  if (url.origin !== self.location.origin) {
    return
  }

  if (url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
          }
          return response
        })
        .catch(() => caches.match(event.request))
    )
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put('/', copy))
          }
          return response
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('/')))
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
