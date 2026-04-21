-- ============================================================
-- 018: Public portal landing — rotating hero + ticker + trial
-- ============================================================

INSERT IGNORE INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('portal.announcement_enabled', 'true', 'boolean',
    'Show the scrolling announcement bar at the top of the public portal.', 0),
  ('portal.announcement',
    '🚀 New customers get a FREE 7-day trial · 📡 Premium Starlink-powered WiFi · 💬 24/7 WhatsApp support',
    'string',
    'Scrolling ticker text at the very top of the public portal. Separate items with ·', 0),
  ('portal.hero_images', '[
      {"url":"https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1600&q=80","caption":"Premium Starlink WiFi"},
      {"url":"https://images.unsplash.com/photo-1614064641938-3bbee52942c7?w=1600&q=80","caption":"Blazing-fast speeds"},
      {"url":"https://images.unsplash.com/photo-1551703599-6b3e8379aa8d?w=1600&q=80","caption":"Connects your whole home"},
      {"url":"https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1600&q=80","caption":"Low-latency for work & gaming"}
    ]', 'json',
    'Hero carousel images (array of {url, caption}). Replace URLs to customise.', 0),
  ('portal.hero_rotate_ms', '4500', 'number',
    'Milliseconds between hero image transitions.', 0),
  ('portal.trial_banner_enabled', 'true', 'boolean',
    'Show the prominent FREE trial banner on the public portal landing.', 0),
  ('portal.trial_days', '7', 'number',
    'Free trial duration in days shown to first-time visitors.', 0),
  ('portal.trial_speed_mbps', '3', 'number',
    'Free trial speed in Mbps shown on the trial banner.', 0);
