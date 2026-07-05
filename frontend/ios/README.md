# iOS app

The web app is a PWA. Android can receive Safari/Chrome shares through the manifest
`share_target`, but iOS Safari does not implement that API. The native iOS wrapper in
this directory adds a Share Extension so G&E Recipes appears in the iPhone share sheet.

The Capacitor shell loads the deployed site (`https://recipes.grantlonie.com` by default).
Sharing a recipe URL from Safari opens the app on `/import` and runs the same auth-gated
import flow as Android.

## Requirements

- macOS with Xcode 15+
- An Apple Developer account for installing on a physical iPhone

## Build and install

```bash
cd frontend
npm install
npm run cap:sync:ios
npm run cap:open:ios
```

In Xcode:

1. Select the **App** target and your iPhone as the run destination.
2. Set your development team under **Signing & Capabilities** for both **App** and
   **ShareExtension**.
3. Build and run on the device.

After installing, open Safari on the iPhone, tap **Share**, and choose **G&E Recipes**.
The app should open and import the shared recipe URL.

## Pointing at another server

Override the loaded site when syncing:

```bash
CAPACITOR_APP_URL=http://192.168.1.10:5173 npm run cap:sync:ios
```

## Home screen PWA vs native app

Adding the website to the iPhone home screen does **not** register it as a share target on
iOS. Use the native app built from this project for Safari sharing.
