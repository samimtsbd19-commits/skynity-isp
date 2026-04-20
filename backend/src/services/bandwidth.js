// ============================================================
// Bandwidth aggregation
// ------------------------------------------------------------
// Produces per-day totals of bytes_in / bytes_out for a single
// subscription, filling in any missing days with zeros so the
// chart is always continuous. Used by both the admin API and
// the customer portal API.
// ============================================================
import db from '../database/pool.js';

export async function bandwidthDaily(subscriptionId, days) {
  const d = Math.max(1, Math.min(90, Number(days) || 14));
  const rows = await db.query(
    `SELECT DATE(taken_at) AS day,
            CAST(SUM(delta_in)  AS UNSIGNED) AS bytes_in,
            CAST(SUM(delta_out) AS UNSIGNED) AS bytes_out
       FROM usage_snapshots
      WHERE subscription_id = ?
        AND taken_at >= CURDATE() - INTERVAL ? DAY
      GROUP BY DATE(taken_at)
      ORDER BY day ASC`,
    [subscriptionId, d - 1]
  );
  const byDay = new Map(rows.map((r) => [String(r.day).slice(0, 10), r]));
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = d - 1; i >= 0; i--) {
    const dt = new Date(today.getTime() - i * 86400000);
    const key = dt.toISOString().slice(0, 10);
    const r = byDay.get(key);
    out.push({
      day: key,
      bytes_in:  Number(r?.bytes_in  || 0),
      bytes_out: Number(r?.bytes_out || 0),
    });
  }
  return out;
}

export default { bandwidthDaily };
