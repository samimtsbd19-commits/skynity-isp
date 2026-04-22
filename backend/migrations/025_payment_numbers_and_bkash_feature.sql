-- Personal-wallet numbers (bKash / Nagad Send Money). Editable anytime in
-- Admin → System Settings → Payment Methods.
-- Tokenized auto-checkout: set env BKASH_* + system_settings feature.bkash_api + bkash.agreement_id.

UPDATE system_settings
SET setting_value = '01811871332'
WHERE setting_key IN ('payment.bkash_number', 'payment.nagad_number')
  AND (setting_value IS NULL OR TRIM(setting_value) = '');

INSERT IGNORE INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
('feature.bkash_api', 'false', 'boolean',
 'When true and BKASH_APP_KEY/SECRET/USERNAME/PASSWORD + agreement ID are configured, customers can use bKash in-app checkout. Send Money + Trx ID always works when payment.bkash_number / payment.nagad_number are set.',
 0),
('bkash.agreement_id', '', 'string',
 'bKash merchant agreement ID (required only for tokenized API checkout, not for Send Money).',
 0);
