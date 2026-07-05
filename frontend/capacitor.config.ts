import type { CapacitorConfig } from '@capacitor/cli'

const appBaseUrl = process.env.CAPACITOR_APP_URL ?? 'https://recipes.grantlonie.com'

const config: CapacitorConfig = {
  appId: 'com.grantlonie.recipes',
  appName: 'G&E Recipes',
  webDir: 'dist',
  server: {
    url: appBaseUrl,
    cleartext: false,
  },
  ios: {
    contentInset: 'automatic',
  },
}

export default config
