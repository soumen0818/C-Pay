-- C-Pay Stellar Supabase schema
-- Run in the Supabase SQL editor for a fresh CPINR/Stellar setup.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    wallet_address TEXT UNIQUE NOT NULL,
    cpay_id TEXT UNIQUE,
    email TEXT UNIQUE,
    phone_number TEXT UNIQUE,
    biometric_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    profile_photo_url TEXT,
    display_name TEXT,
    stellar_network TEXT NOT NULL DEFAULT 'testnet',
    cpinr_asset_code TEXT NOT NULL DEFAULT 'CPINR',
    cpinr_asset_issuer TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    business_name TEXT NOT NULL,
    wallet_address TEXT UNIQUE NOT NULL,
    cpay_id TEXT UNIQUE,
    owner_name TEXT,
    email TEXT,
    phone_number TEXT,
    business_address TEXT,
    business_registration_number TEXT,
    description TEXT,
    category TEXT,
    logo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    total_transactions INTEGER NOT NULL DEFAULT 0,
    total_revenue NUMERIC(20, 7) NOT NULL DEFAULT 0,
    stellar_network TEXT NOT NULL DEFAULT 'testnet',
    cpinr_asset_code TEXT NOT NULL DEFAULT 'CPINR',
    cpinr_asset_issuer TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    transaction_id TEXT UNIQUE,
    transaction_type TEXT NOT NULL DEFAULT 'personal' CHECK (
        transaction_type IN ('personal', 'merchant', 'add_money', 'account_setup')
    ),
    merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
    tx_hash TEXT UNIQUE NOT NULL,
    stellar_network TEXT NOT NULL DEFAULT 'testnet',
    asset_code TEXT NOT NULL DEFAULT 'CPINR',
    asset_issuer TEXT,
    to_address TEXT NOT NULL,
    from_address TEXT NOT NULL DEFAULT '',
    amount NUMERIC(20, 7) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'success', 'failed')
    ),
    internal_status TEXT NOT NULL DEFAULT 'processing' CHECK (
        internal_status IN ('processing', 'submitted', 'confirmed', 'failed')
    ),
    user_visible_status TEXT NOT NULL DEFAULT 'success' CHECK (
        user_visible_status IN ('success', 'failed')
    ),
    merchant_name TEXT,
    note TEXT,
    sender_name TEXT,
    recipient_name TEXT,
    failure_reason TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS merchant_qr_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    qr_name TEXT NOT NULL,
    amount NUMERIC(20, 7),
    asset_code TEXT NOT NULL DEFAULT 'CPINR',
    asset_issuer TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    scan_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS add_money_claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address TEXT NOT NULL,
    amount NUMERIC(20, 7) NOT NULL CHECK (amount > 0),
    asset_code TEXT NOT NULL DEFAULT 'CPINR',
    asset_issuer TEXT,
    tx_hash TEXT UNIQUE,
    idempotency_key TEXT UNIQUE,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_available_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS relayer_idempotency_keys (
    key TEXT PRIMARY KEY,
    response JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_backups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_address TEXT NOT NULL,
    backup_version INTEGER NOT NULL DEFAULT 1,
    cipher TEXT NOT NULL DEFAULT 'xchacha20-poly1305',
    kdf TEXT NOT NULL DEFAULT 'pbkdf2-sha256',
    kdf_iterations INTEGER NOT NULL,
    salt TEXT NOT NULL,
    nonce TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(auth_user_id),
    UNIQUE(wallet_address)
);

-- Existing-project compatibility. Safe for empty/new projects and useful if
-- the table already exists from an older local setup.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cpay_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stellar_network TEXT NOT NULL DEFAULT 'testnet';
ALTER TABLE users ADD COLUMN IF NOT EXISTS cpinr_asset_code TEXT NOT NULL DEFAULT 'CPINR';
ALTER TABLE users ADD COLUMN IF NOT EXISTS cpinr_asset_issuer TEXT;
ALTER TABLE users DROP COLUMN IF EXISTS pin_hash;

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS cpay_id TEXT UNIQUE;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS business_address TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS business_registration_number TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS total_transactions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS total_revenue NUMERIC(20, 7) NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS stellar_network TEXT NOT NULL DEFAULT 'testnet';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS cpinr_asset_code TEXT NOT NULL DEFAULT 'CPINR';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS cpinr_asset_issuer TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_id TEXT UNIQUE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'personal';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS stellar_network TEXT NOT NULL DEFAULT 'testnet';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS asset_code TEXT NOT NULL DEFAULT 'CPINR';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS asset_issuer TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recipient_name TEXT;

CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_cpay_id ON users(cpay_id);
CREATE INDEX IF NOT EXISTS idx_merchants_wallet_address ON merchants(wallet_address);
CREATE INDEX IF NOT EXISTS idx_merchants_auth_user_id ON merchants(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_merchants_cpay_id ON merchants(cpay_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_from_address ON transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_transactions_to_address ON transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_id ON transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_qr_codes_merchant_id ON merchant_qr_codes(merchant_id);
CREATE INDEX IF NOT EXISTS idx_add_money_claims_wallet_address ON add_money_claims(wallet_address);
CREATE INDEX IF NOT EXISTS idx_add_money_claims_claimed_at ON add_money_claims(claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_relayer_idempotency_expires_at ON relayer_idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_wallet_backups_auth_user_id ON wallet_backups(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_backups_wallet_address ON wallet_backups(wallet_address);

-- Backfill ownership for existing rows before stricter RLS takes effect.
-- Supabase phone auth stores verified numbers in auth.users.phone.
UPDATE users u
SET auth_user_id = au.id
FROM auth.users au
WHERE u.auth_user_id IS NULL
  AND u.phone_number IS NOT NULL
  AND au.phone = u.phone_number;

-- Email OTP auth stores verified addresses in auth.users.email.
UPDATE users u
SET auth_user_id = au.id
FROM auth.users au
WHERE u.auth_user_id IS NULL
  AND u.email IS NOT NULL
  AND au.email = u.email;

UPDATE users u
SET email = au.email
FROM auth.users au
WHERE u.email IS NULL
  AND u.auth_user_id = au.id
  AND au.email IS NOT NULL;

UPDATE merchants m
SET auth_user_id = u.auth_user_id
FROM users u
WHERE m.auth_user_id IS NULL
  AND m.wallet_address = u.wallet_address
  AND u.auth_user_id IS NOT NULL;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE add_money_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE relayer_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_backups ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION set_row_auth_user_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.auth_user_id IS NULL THEN
    NEW.auth_user_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS set_users_auth_user_id ON users;
CREATE TRIGGER set_users_auth_user_id
BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION set_row_auth_user_id();

DROP TRIGGER IF EXISTS set_merchants_auth_user_id ON merchants;
CREATE TRIGGER set_merchants_auth_user_id
BEFORE INSERT ON merchants
FOR EACH ROW EXECUTE FUNCTION set_row_auth_user_id();

CREATE OR REPLACE FUNCTION current_wallet_address()
RETURNS TEXT AS $$
  SELECT wallet_address
  FROM users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_public_wallet_profile(p_wallet_address TEXT)
RETURNS TABLE (
  wallet_address TEXT,
  cpay_id TEXT,
  display_name TEXT
) AS $$
  SELECT u.wallet_address, u.cpay_id, u.display_name
  FROM users u
  WHERE u.wallet_address = p_wallet_address;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION resolve_cpay_id(p_cpay_id TEXT)
RETURNS TABLE (
  wallet_address TEXT,
  cpay_id TEXT,
  display_name TEXT,
  account_type TEXT
) AS $$
  SELECT u.wallet_address, u.cpay_id, u.display_name, 'user'::TEXT
  FROM users u
  WHERE lower(u.cpay_id) = lower(p_cpay_id)
  UNION ALL
  SELECT m.wallet_address, m.cpay_id, m.business_name AS display_name, 'merchant'::TEXT
  FROM merchants m
  WHERE lower(m.cpay_id) = lower(p_cpay_id) AND m.is_active = TRUE
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_public_merchant_by_id(p_merchant_id UUID)
RETURNS TABLE (
  id UUID,
  business_name TEXT,
  wallet_address TEXT,
  cpay_id TEXT,
  category TEXT,
  description TEXT,
  logo_url TEXT,
  is_active BOOLEAN
) AS $$
  SELECT m.id, m.business_name, m.wallet_address, m.cpay_id, m.category, m.description, m.logo_url, m.is_active
  FROM merchants m
  WHERE m.id = p_merchant_id AND m.is_active = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_public_merchant_by_address(p_wallet_address TEXT)
RETURNS TABLE (
  id UUID,
  business_name TEXT,
  wallet_address TEXT,
  cpay_id TEXT,
  category TEXT,
  description TEXT,
  logo_url TEXT,
  is_active BOOLEAN
) AS $$
  SELECT m.id, m.business_name, m.wallet_address, m.cpay_id, m.category, m.description, m.logo_url, m.is_active
  FROM merchants m
  WHERE m.wallet_address = p_wallet_address AND m.is_active = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_own_merchant_by_wallet(p_wallet_address TEXT)
RETURNS TABLE (
  id UUID,
  auth_user_id UUID,
  business_name TEXT,
  wallet_address TEXT,
  cpay_id TEXT,
  owner_name TEXT,
  email TEXT,
  phone_number TEXT,
  business_address TEXT,
  business_registration_number TEXT,
  description TEXT,
  category TEXT,
  logo_url TEXT,
  is_active BOOLEAN,
  total_transactions INTEGER,
  total_revenue NUMERIC,
  stellar_network TEXT,
  cpinr_asset_code TEXT,
  cpinr_asset_issuer TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
  SELECT
    m.id,
    m.auth_user_id,
    m.business_name,
    m.wallet_address,
    m.cpay_id,
    m.owner_name,
    m.email,
    m.phone_number,
    m.business_address,
    m.business_registration_number,
    m.description,
    m.category,
    m.logo_url,
    m.is_active,
    m.total_transactions,
    m.total_revenue,
    m.stellar_network,
    m.cpinr_asset_code,
    m.cpinr_asset_issuer,
    m.created_at,
    m.updated_at
  FROM merchants m
  WHERE m.wallet_address = p_wallet_address
    AND (
      m.auth_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND u.wallet_address = m.wallet_address
      )
    )
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION current_wallet_address() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_wallet_profile(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_cpay_id(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_merchant_by_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_merchant_by_address(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_own_merchant_by_wallet(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_public_wallet_profile(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_cpay_id(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_public_merchant_by_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_public_merchant_by_address(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION current_wallet_address() TO authenticated;
GRANT EXECUTE ON FUNCTION get_own_merchant_by_wallet(TEXT) TO authenticated;

DROP POLICY IF EXISTS "users_select" ON users;
DROP POLICY IF EXISTS "users_select_own" ON users;
CREATE POLICY "users_select_own" ON users
FOR SELECT
USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

DROP POLICY IF EXISTS "users_insert" ON users;
DROP POLICY IF EXISTS "users_insert_own" ON users;
CREATE POLICY "users_insert_own" ON users
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL AND (auth_user_id IS NULL OR auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users
FOR UPDATE
USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid())
WITH CHECK (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

DROP POLICY IF EXISTS "merchants_select" ON merchants;
DROP POLICY IF EXISTS "merchants_select_own" ON merchants;
CREATE POLICY "merchants_select_own" ON merchants
FOR SELECT
USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

DROP POLICY IF EXISTS "merchants_insert" ON merchants;
DROP POLICY IF EXISTS "merchants_insert_own" ON merchants;
CREATE POLICY "merchants_insert_own" ON merchants
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL AND (auth_user_id IS NULL OR auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "merchants_update" ON merchants;
DROP POLICY IF EXISTS "merchants_update_own" ON merchants;
CREATE POLICY "merchants_update_own" ON merchants
FOR UPDATE
USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid())
WITH CHECK (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

DROP POLICY IF EXISTS "transactions_select" ON transactions;
DROP POLICY IF EXISTS "transactions_select_participant" ON transactions;
CREATE POLICY "transactions_select_participant" ON transactions
FOR SELECT
USING (
  auth.uid() IS NOT NULL AND (
    from_address = current_wallet_address()
    OR to_address = current_wallet_address()
    OR merchant_id IN (
      SELECT id FROM merchants WHERE auth_user_id = auth.uid()
    )
  )
);

-- Only the relayer/service role may insert or update transaction rows.
-- This prevents forged client writes and keeps merchant revenue/status
-- authoritative.
DROP POLICY IF EXISTS "transactions_insert" ON transactions;
DROP POLICY IF EXISTS "transactions_insert_participant" ON transactions;
DROP POLICY IF EXISTS "transactions_update" ON transactions;
DROP POLICY IF EXISTS "transactions_update_participant" ON transactions;

DROP POLICY IF EXISTS "merchant_qr_codes_select" ON merchant_qr_codes;
DROP POLICY IF EXISTS "merchant_qr_codes_select_own" ON merchant_qr_codes;
CREATE POLICY "merchant_qr_codes_select_own" ON merchant_qr_codes
FOR SELECT
USING (
  auth.uid() IS NOT NULL AND merchant_id IN (
    SELECT id FROM merchants WHERE auth_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "merchant_qr_codes_manage" ON merchant_qr_codes;
DROP POLICY IF EXISTS "merchant_qr_codes_manage_own" ON merchant_qr_codes;
CREATE POLICY "merchant_qr_codes_manage_own" ON merchant_qr_codes
FOR ALL
USING (
  auth.uid() IS NOT NULL AND merchant_id IN (
    SELECT id FROM merchants WHERE auth_user_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND merchant_id IN (
    SELECT id FROM merchants WHERE auth_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "add_money_claims_service_select" ON add_money_claims;

DROP POLICY IF EXISTS "relayer_idempotency_service_select" ON relayer_idempotency_keys;

REVOKE ALL ON add_money_claims FROM anon, authenticated;
REVOKE ALL ON relayer_idempotency_keys FROM anon, authenticated;

DROP POLICY IF EXISTS "wallet_backups_select_own" ON wallet_backups;
CREATE POLICY "wallet_backups_select_own" ON wallet_backups
FOR SELECT
USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

DROP POLICY IF EXISTS "wallet_backups_insert_own" ON wallet_backups;
CREATE POLICY "wallet_backups_insert_own" ON wallet_backups
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

DROP POLICY IF EXISTS "wallet_backups_update_own" ON wallet_backups;
CREATE POLICY "wallet_backups_update_own" ON wallet_backups
FOR UPDATE
USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid())
WITH CHECK (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

DROP POLICY IF EXISTS "wallet_backups_delete_own" ON wallet_backups;
CREATE POLICY "wallet_backups_delete_own" ON wallet_backups
FOR DELETE
USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON wallet_backups TO authenticated;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_merchants_updated_at ON merchants;
CREATE TRIGGER update_merchants_updated_at
BEFORE UPDATE ON merchants
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
CREATE TRIGGER update_transactions_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_merchant_qr_codes_updated_at ON merchant_qr_codes;
CREATE TRIGGER update_merchant_qr_codes_updated_at
BEFORE UPDATE ON merchant_qr_codes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_wallet_backups_updated_at ON wallet_backups;
CREATE TRIGGER update_wallet_backups_updated_at
BEFORE UPDATE ON wallet_backups
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION refresh_merchant_totals(p_merchant_id UUID)
RETURNS VOID AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE merchants m
  SET
    total_transactions = COALESCE((
      SELECT COUNT(*)::INTEGER
      FROM transactions t
      WHERE t.merchant_id = p_merchant_id
        AND t.transaction_type = 'merchant'
        AND t.status = 'success'
    ), 0),
    total_revenue = COALESCE((
      SELECT SUM(t.amount)
      FROM transactions t
      WHERE t.merchant_id = p_merchant_id
        AND t.transaction_type = 'merchant'
        AND t.status = 'success'
    ), 0),
    updated_at = NOW()
  WHERE m.id = p_merchant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION update_merchant_totals_from_transaction()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_merchant_totals(OLD.merchant_id);
    RETURN OLD;
  END IF;

  PERFORM refresh_merchant_totals(NEW.merchant_id);

  IF TG_OP = 'UPDATE' AND OLD.merchant_id IS DISTINCT FROM NEW.merchant_id THEN
    PERFORM refresh_merchant_totals(OLD.merchant_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_merchant_totals_on_transactions ON transactions;
CREATE TRIGGER update_merchant_totals_on_transactions
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION update_merchant_totals_from_transaction();
