'use strict';

const { loadConfig } = require('./config');

const validEnv = {
  NODE_ENV: 'development',
  STELLAR_NETWORK: 'testnet',
  SPONSOR_SECRET: 'S_TEST_SPONSOR',
  DISTRIBUTION_SECRET: 'S_TEST_DISTRIBUTION',
  RELAYER_AUTH_REQUIRED: 'false',
  CORS_ORIGIN: '*',
};

describe('loadConfig', () => {
  it('uses secure authentication defaults outside explicit development', () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: 'test',
      RELAYER_AUTH_REQUIRED: undefined,
      CORS_ORIGIN: 'https://app.example.com',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });

    expect(config.authRequired).toBe(true);
  });

  it('allows disabled authentication only in explicit development', () => {
    expect(loadConfig(validEnv).authRequired).toBe(false);
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'test' })).toThrow(
      'RELAYER_AUTH_REQUIRED=false is allowed only when NODE_ENV=development',
    );
  });

  it('always uses zero as the sponsored account starting balance', () => {
    expect(loadConfig(validEnv).startingBalance).toBe('0');
    expect(loadConfig({ ...validEnv, STARTING_BALANCE: '1.5' }).startingBalance).toBe('0');
  });

  it.each([
    ['unknown Stellar network', { STELLAR_NETWORK: 'mainnet' }, 'STELLAR_NETWORK must be one of'],
    ['invalid numeric limit', { MAX_PAYMENT_AMOUNT: 'abc' }, 'MAX_PAYMENT_AMOUNT must be'],
    ['out-of-range numeric limit', { MAX_PAYMENT_AMOUNT: '0' }, 'MAX_PAYMENT_AMOUNT must be'],
    ['invalid boolean', { LEDGER_INGEST_ENABLED: 'maybe' }, 'LEDGER_INGEST_ENABLED must be a boolean'],
  ])('rejects %s', (_description, overrides, message) => {
    expect(() => loadConfig({ ...validEnv, ...overrides })).toThrow(message);
  });

  it('rejects wildcard CORS in production', () => {
    expect(() => loadConfig({
      ...validEnv,
      NODE_ENV: 'production',
      RELAYER_AUTH_REQUIRED: 'true',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })).toThrow('CORS_ORIGIN must name one or more trusted origins when NODE_ENV=production');
  });

  it('does not accept the Expo public URL as server-side Supabase configuration', () => {
    expect(() => loadConfig({
      ...validEnv,
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://app.example.com',
      RELAYER_AUTH_REQUIRED: 'true',
      EXPO_PUBLIC_SUPABASE_URL: 'https://public-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })).toThrow('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  });

  it('sets secure JWT and JWKS configuration defaults', () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: 'test',
      RELAYER_AUTH_REQUIRED: 'true',
      CORS_ORIGIN: 'https://app.example.com',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });

    expect(config.supabaseJwtAudience).toBe('authenticated');
    expect(config.supabaseJwtIssuer).toBe('https://project.supabase.co/auth/v1');
    expect(config.supabaseJwksUrl).toBe('https://project.supabase.co/auth/v1/.well-known/jwks.json');
    expect(config.supabaseAuthFallbackToApi).toBe(false);
  });

  it('allows explicit overrides for JWT audience, issuer, JWKS URL and API fallback', () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: 'test',
      RELAYER_AUTH_REQUIRED: 'true',
      CORS_ORIGIN: 'https://app.example.com',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_JWT_AUDIENCE: 'custom-aud',
      SUPABASE_JWT_ISSUER: 'https://auth.custom.com',
      SUPABASE_JWKS_URL: 'https://auth.custom.com/.well-known/jwks.json',
      SUPABASE_AUTH_FALLBACK_TO_API: 'true',
    });

    expect(config.supabaseJwtAudience).toBe('custom-aud');
    expect(config.supabaseJwtIssuer).toBe('https://auth.custom.com');
    expect(config.supabaseJwksUrl).toBe('https://auth.custom.com/.well-known/jwks.json');
    expect(config.supabaseAuthFallbackToApi).toBe(true);
  });
});
