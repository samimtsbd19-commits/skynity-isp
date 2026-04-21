// ============================================================
// Client-side push registration
// ------------------------------------------------------------
// Works in two modes:
//
//   * Web / PWA — uses the Push API + a VAPID-less FCM setup by
//     posting the ServiceWorker subscription endpoint as the
//     token. The backend treats the endpoint string as an FCM
//     registration id. For simple setups you instead expose a
//     `push.vapid_public_key` and switch to VAPID.
//
//   * Capacitor native shell — when window.Capacitor is present
//     and the @capacitor/push-notifications plugin is bundled,
//     we use its `registration` event instead.
//
// Either way we end up POST-ing the token to
// /api/push/register so the backend can store and later use it.
// ============================================================

import api from '../api/client';

const TOKEN_KEY = 'skynity_push_token';

/** Register with FCM/Capacitor and send the token to the server. */
export async function registerPush({ silent = true } = {}) {
  try {
    // --- Native (Capacitor) path ---------------------------------
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
      const { PushNotifications } = await import('@capacitor/push-notifications').catch(() => ({}));
      if (!PushNotifications) return { ok: false, reason: 'no plugin' };
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return { ok: false, reason: 'permission denied' };

      return new Promise((resolve) => {
        PushNotifications.addListener('registration', async ({ value }) => {
          try {
            await api.post('/push/register', {
              token: value,
              platform: window.Capacitor.getPlatform?.() === 'ios' ? 'ios' : 'android',
              app_version: window.__APP_VERSION__ || null,
              locale: navigator.language,
            });
            localStorage.setItem(TOKEN_KEY, value);
            resolve({ ok: true, token: value });
          } catch (err) { resolve({ ok: false, reason: err.message }); }
        });
        PushNotifications.addListener('registrationError', (e) => resolve({ ok: false, reason: e.error }));
        PushNotifications.register();
      });
    }

    // --- Web / PWA path ------------------------------------------
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { ok: false, reason: 'push not supported' };
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'permission denied' };

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // Try to subscribe without VAPID first (FCM legacy works this way
      // when the SW is loaded from an origin whitelisted in Firebase).
      try {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true });
      } catch {
        return { ok: false, reason: 'subscribe failed — VAPID key not configured' };
      }
    }
    const token = JSON.stringify(sub.toJSON());
    await api.post('/push/register', {
      token,
      platform: 'web',
      app_version: window.__APP_VERSION__ || null,
      locale: navigator.language,
    });
    localStorage.setItem(TOKEN_KEY, token);
    return { ok: true, token };
  } catch (err) {
    if (!silent) throw err;
    return { ok: false, reason: err.message };
  }
}

export async function unregisterPush() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return { ok: true };
  try {
    await api.post('/push/unregister', { token });
  } catch { /* ignore */ }
  localStorage.removeItem(TOKEN_KEY);
  return { ok: true };
}
