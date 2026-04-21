// Small indirection so telegram/*.js can stop/start polling without
// importing the heavy bot module (avoids circular imports).

let _bot = null;

export function attachBot(b) {
  _bot = b;
}

export async function stopTelegramPolling() {
  if (_bot && typeof _bot.stopPolling === 'function') {
    await _bot.stopPolling();
  }
}

export async function startTelegramPolling() {
  if (_bot && typeof _bot.startPolling === 'function') {
    await _bot.startPolling();
  }
}
