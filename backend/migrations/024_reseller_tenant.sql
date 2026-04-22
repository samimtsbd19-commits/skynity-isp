-- ============================================================
-- 024: Reseller tenant columns
-- ============================================================
SET NAMES utf8mb4;

ALTER TABLE admins
  ADD COLUMN reseller_parent_id INT UNSIGNED NULL COMMENT 'Parent admin who created this reseller',
  ADD COLUMN commission_pct DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'Reseller commission %';

ALTER TABLE customers
  ADD COLUMN reseller_id INT UNSIGNED NULL,
  ADD KEY idx_customer_reseller (reseller_id),
  ADD CONSTRAINT fk_customer_reseller FOREIGN KEY (reseller_id) REFERENCES admins(id) ON DELETE SET NULL;

ALTER TABLE subscriptions
  ADD COLUMN reseller_id INT UNSIGNED NULL,
  ADD KEY idx_sub_reseller (reseller_id);

ALTER TABLE orders
  ADD COLUMN reseller_id INT UNSIGNED NULL,
  ADD KEY idx_order_reseller (reseller_id);
