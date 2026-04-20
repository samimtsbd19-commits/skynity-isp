-- ============================================================
-- Skynity ISP — Phase 6: MAC binding + Renewals
-- ============================================================
--
-- What this migration adds
--
-- 1. `mac_address` / `bind_to_mac` on subscriptions so a user can
--    be locked to the first MAC that logged in. Prevents credential
--    sharing across devices.
--
-- 2. `mac_address` on orders + vouchers so the captive-portal can
--    forward the client MAC at purchase time and we persist it from
--    there straight into the subscription.
--
-- 3. `renewal_of_subscription_id` on orders so "Renew" is a
--    first-class flow — admin approval extends the existing
--    subscription instead of creating a brand-new one.
--
-- MikroTik side
--
-- * PPPoE: `/ppp/secret` supports `caller-id`. RouterOS accepts
--   a MAC address there and denies login from any other device.
-- * Hotspot: `/ip/hotspot/user` has `mac-address` which RouterOS
--   already treats as a hard bind.
--
-- Both get populated when the subscription is created, if a MAC
-- is available.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ----------- Subscriptions: bind-to-mac ----------------------
ALTER TABLE subscriptions
  ADD COLUMN mac_address VARCHAR(17) NULL AFTER login_password,
  ADD COLUMN bind_to_mac TINYINT(1) NOT NULL DEFAULT 0 AFTER mac_address,
  ADD INDEX idx_sub_mac (mac_address);

-- ----------- Orders: capture MAC + mark renewals -------------
ALTER TABLE orders
  ADD COLUMN mac_address VARCHAR(17) NULL AFTER phone,
  ADD COLUMN renewal_of_subscription_id INT UNSIGNED NULL AFTER subscription_id,
  ADD CONSTRAINT fk_order_renewal
    FOREIGN KEY (renewal_of_subscription_id) REFERENCES subscriptions(id)
    ON DELETE SET NULL;

-- ----------- Vouchers: optional MAC at redeem time -----------
ALTER TABLE vouchers
  ADD COLUMN mac_address VARCHAR(17) NULL AFTER redeemed_by_phone;

-- ----------- Settings for MAC binding policy -----------------
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
('provisioning.bind_to_mac_default', 'false', 'boolean',
 'When true, new subscriptions with a known MAC are MAC-locked on the MikroTik automatically.', 0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
