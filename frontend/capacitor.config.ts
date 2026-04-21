// Capacitor config for the Skynity ISP mobile app.
//
// The app is a thin shell around the existing PWA; web assets
// live in `dist/` after `npm run build`. For local dev against
// a remote VPS you can flip `server.url` to your domain so the
// APK loads live content (no republish needed for HTML/JS tweaks).
//
// To scaffold platforms:
//   npm run cap:install
//   npm run cap:init         # first time only
//   npm run cap:add-android
//   npm run cap:sync

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.skynity.isp',
  appName: 'Skynity ISP',
  webDir: 'dist',
  // Uncomment for dev-against-live-server:
  // server: { url: 'https://wifi.skynity.org', cleartext: false },
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
