# Skynity ISP — Mobile App (Android / iOS)

The mobile app is a thin [Capacitor](https://capacitorjs.com/) shell around
the existing Skynity portal PWA. That means the same React code you
ship to the browser runs inside the native app — you only need to
build the Capacitor wrapper when you want to publish to the Play
Store / App Store or ship push notifications.

## 1. Prerequisites (local dev machine only)

| Tool           | Version      | Notes                                   |
| -------------- | ------------ | --------------------------------------- |
| Node           | 20.x         | same as the website                     |
| JDK            | 17 (Android) | install via Android Studio              |
| Android Studio | latest       | https://developer.android.com/studio    |
| Xcode          | 15+ (iOS)    | macOS only                              |

> **The VPS does not need any of this.** Capacitor builds happen on
> your laptop only; the VPS keeps serving the web portal.

## 2. One-time scaffold

From the `frontend/` folder:

```bash
npm install                  # ensures @capacitor/core + push-notifications (already in package.json)
npm run cap:install          # optional: adds CLI + android/ios packages if you trimmed deps
```

`capacitor.config.ts` is already in the repo (`org.skynity.isp`, web dir `dist`).
**Do not run `cap:init`** if that file exists — it would overwrite the app id.

Create native projects when the folders are missing:

```bash
npm run cap:add-android      # creates android/ when not present
npm run cap:add-ios          # macOS only
```

If you truly need a fresh Capacitor project, remove `android/`, `ios/`, and
`capacitor.config.ts` first, then run `npm run cap:init` with the same app id
as documented in `frontend/package.json` (`Skynity` / `org.skynity.isp`).

## 3. Rebuild + sync after web changes

Whenever you update the React code and want the mobile shell to see
the new build:

```bash
npm run cap:sync             # = vite build + npx cap sync
```

## 4. Open in Android Studio / Xcode

```bash
npm run cap:open-android
npm run cap:open-ios
```

Hit ▶ inside the IDE to run on an emulator or a cable-connected device.

## 5. Push notifications

1. Create a Firebase project → add Android + iOS apps with the same
   bundle id (`org.skynity.isp`).
2. Download `google-services.json` → place in `android/app/`.
   Download `GoogleService-Info.plist` → drag into Xcode.
3. Copy the **Cloud Messaging → Server key** (legacy API).
4. In the admin portal → **System settings**:
   - `push.enabled` → `true`
   - `push.fcm_server_key` → paste the server key
5. Rebuild and install the app on a device.  On first login the
   portal automatically calls `registerPush()` which posts the FCM
   token to `/api/push/register`.

### Test it

Admin portal endpoint:

```http
POST /api/push/test
Content-Type: application/json

{ "customer_id": 42, "title": "Test", "body": "It works!" }
```

or broadcast an Offer — the fan-out now includes push alongside
Telegram / SMS / WhatsApp.

## 6. Signing & Play Store

Follow the standard Capacitor [Android publishing guide](https://capacitorjs.com/docs/android/deploying-to-google-play).
For iOS you need a paid Apple Developer account.

## 7. Where to put the download links

System settings:

- `site.app_android_url` — Play Store URL *or* direct APK link.
- `site.app_ios_url`     — App Store URL.

As soon as either is set the public portal renders the **“Get the
mobile app”** banner at the top of the landing page.

---

### Backend surface that already exists for this

| Endpoint                     | Who          | What                             |
| ---------------------------- | ------------ | -------------------------------- |
| `POST /api/push/register`    | public       | store an FCM token (+ link it)   |
| `POST /api/push/unregister`  | public       | drop a token on logout           |
| `GET  /api/push/tokens`      | admin        | list registered devices          |
| `POST /api/push/test`        | admin        | send a push to one customer / all|

Tokens rejected by FCM as `NotRegistered` / `InvalidRegistration` are
automatically marked `disabled` so they aren’t retried.
