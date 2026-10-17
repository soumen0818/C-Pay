'use strict';

const {
  SupabaseRequestError,
  executeSupabaseRequest,
  isPostgresUniqueViolation,
} = require('../supabaseRest');

function makeResponse(ok, status, data, rawText) {
  const body = rawText !== undefined ? rawText : (data !== null ? JSON.stringify(data) : '');
  return {
    ok,
    status,
    text: async () => body,
    json: async () => data,
  };
}

describe('Supabase REST & SupabaseRequestError (Issue #121)', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('SupabaseRequestError', () => {
    it('constructs with status, code, details, hint, and safe message', () => {
      const error = new SupabaseRequestError({
        status: 409,
        code: '23505',
        details: 'Key (key)=(add-money-user:user-123) already exists.',
        hint: 'Check unique constraint',
        body: { code: '23505', message: 'duplicate key value violates unique constraint' },
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SupabaseRequestError);
      expect(error.name).toBe('SupabaseRequestError');
      expect(error.status).toBe(409);
      expect(error.code).toBe('23505');
      expect(error.details).toBe('Key (key)=(add-money-user:user-123) already exists.');
      expect(error.hint).toBe('Check unique constraint');
      expect(error.message).toBe('Supabase request failed with status 409');
      expect(error.response).toEqual({
        status: 409,
        data: { code: '23505', message: 'duplicate key value violates unique constraint' },
      });
    });

    it('does not leak raw JSON or DB internals in error.message', () => {
      const rawJson = '{"code":"23505","details":"Key (key)=(secret_key) already exists.","message":"duplicate key"}';
      const error = new SupabaseRequestError({
        status: 409,
        code: '23505',
        details: 'Key (key)=(secret_key) already exists.',
        body: JSON.parse(rawJson),
      });

      expect(error.message).not.toContain(rawJson);
      expect(error.message).not.toContain('secret_key');
      expect(error.message).toBe('Supabase request failed with status 409');
    });
  });

  describe('executeSupabaseRequest', () => {
    it('throws SupabaseRequestError with real PostgREST error shape and logs raw body', async () => {
      const postgrestBody = {
        code: '23505',
        details: 'Key (key)=(add-money-user:user-1) already exists.',
        hint: null,
        message: 'duplicate key value violates unique constraint "relayer_idempotency_keys_pkey"',
      };
      const rawText = JSON.stringify(postgrestBody);

      const mockFetch = jest.fn(async () => makeResponse(false, 409, postgrestBody, rawText));

      let caughtError = null;
      try {
        await executeSupabaseRequest({
          baseUrl: 'https://test.supabase.co',
          serviceRoleKey: 'test-key',
          path: 'relayer_idempotency_keys',
          options: { method: 'POST', body: JSON.stringify({ key: 'add-money-user:user-1' }) },
          fetchFn: mockFetch,
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(SupabaseRequestError);
      expect(caughtError.status).toBe(409);
      expect(caughtError.code).toBe('23505');
      expect(caughtError.details).toBe('Key (key)=(add-money-user:user-1) already exists.');
      expect(caughtError.hint).toBeNull();
      expect(caughtError.message).toBe('Supabase request failed with status 409');
      expect(caughtError.message).not.toContain(rawText);

      // Raw response body must be logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Supabase request failed with status 409:',
        rawText
      );
    });

    it('returns parsed JSON for successful response', async () => {
      const mockFetch = jest.fn(async () => makeResponse(true, 200, [{ id: 1, name: 'test' }]));

      const result = await executeSupabaseRequest({
        baseUrl: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
        path: 'test_table',
        fetchFn: mockFetch,
      });

      expect(result).toEqual([{ id: 1, name: 'test' }]);
    });

    it('returns null for empty body (e.g. 204 or return=minimal 201)', async () => {
      const mockFetch = jest.fn(async () => makeResponse(true, 204, null, ''));

      const result = await executeSupabaseRequest({
        baseUrl: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
        path: 'relayer_idempotency_keys',
        options: { method: 'POST' },
        fetchFn: mockFetch,
      });

      expect(result).toBeNull();
    });

    it('throws error if response is not JSON', async () => {
      const mockFetch = jest.fn(async () => makeResponse(true, 200, null, '<html>502 Bad Gateway</html>'));

      await expect(executeSupabaseRequest({
        baseUrl: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
        path: 'test_table',
        fetchFn: mockFetch,
      })).rejects.toThrow('Supabase returned a non-JSON response');
    });
  });

  describe('isPostgresUniqueViolation', () => {
    it('returns true for PostgREST conflict body with code 23505', () => {
      const error = new SupabaseRequestError({
        status: 409,
        code: '23505',
        details: 'Key already exists',
        hint: null,
      });

      expect(isPostgresUniqueViolation(error)).toBe(true);
    });

    it('returns true when status is 409 or code is 23505 without substring matching', () => {
      expect(isPostgresUniqueViolation({ status: 409 })).toBe(true);
      expect(isPostgresUniqueViolation({ code: '23505' })).toBe(true);
      expect(isPostgresUniqueViolation({ response: { status: 409 } })).toBe(true);
      expect(isPostgresUniqueViolation({ body: { code: '23505' } })).toBe(true);
    });

    it('returns false for non-conflict errors and does not match on message substrings', () => {
      expect(isPostgresUniqueViolation(null)).toBe(false);
      expect(isPostgresUniqueViolation(undefined)).toBe(false);
      expect(isPostgresUniqueViolation({ status: 500, code: 'PGRST000' })).toBe(false);
      // An error whose message just happens to contain '409' or '23505' must not be mistaken for conflict
      expect(isPostgresUniqueViolation({ status: 500, message: 'Server failed at line 409 with error 23505' })).toBe(false);
    });
  });
});
