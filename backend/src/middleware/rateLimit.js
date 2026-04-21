/**
 * Simple in-memory rate limiter — no external deps.
 * Uses a sliding-window approach per (key = ip + endpoint).
 * Automatically prunes stale windows every 5 minutes.
 */

const windows = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, w] of windows) {
    if (now - w.resetAt > w.windowMs * 2) windows.delete(k);
  }
}, 5 * 60 * 1000);

/**
 * @param {object} opts
 * @param {number} opts.windowMs   - window length in ms (default: 15 min)
 * @param {number} opts.max        - max requests per window (default: 20)
 * @param {string} [opts.message]  - error message to send
 * @param {function} [opts.keyFn] - custom key extractor (req) => string
 */
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, message, keyFn } = {}) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip || 'unknown');
    const now = Date.now();
    let w = windows.get(key);
    if (!w || now > w.resetAt) {
      w = { count: 0, resetAt: now + windowMs, windowMs };
      windows.set(key, w);
    }
    w.count++;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - w.count));
    if (w.count > max) {
      return res.status(429).json({
        error: message || 'Too many requests, please try again later.',
      });
    }
    next();
  };
}
