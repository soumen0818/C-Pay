'use strict';

/**
 * Typed error for Supabase / PostgREST REST API requests (Issue #121).
 *
 * Carries HTTP status, PostgREST error code, details, and hint.
 * Protects against leaking raw response bodies / internal DB schemas in message (R-18).
 */
class SupabaseRequestError extends Error {
  constructor(optionsOrMessage = {}, maybeStatus) {
    let status;
    let code = null;
    let details = null;
    let hint = null;
    let message = null;
    let body = null;

    if (typeof optionsOrMessage === 'string') {
      message = optionsOrMessage;
      status = maybeStatus;
    } else if (typeof optionsOrMessage === 'object' && optionsOrMessage !== null) {
      status = optionsOrMessage.status;
      code = optionsOrMessage.code || null;
      details = optionsOrMessage.details || null;
      hint = optionsOrMessage.hint || null;
      message = optionsOrMessage.message || null;
      body = optionsOrMessage.body || null;
    }

    const safeMessage = message || `Supabase request failed with status ${status}`;
    super(safeMessage);
    this.name = 'SupabaseRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = hint;
    this.body = body || (code || details || hint ? { code, details, hint } : null);
    this.response = { status, data: this.body };
  }
}

/**
 * Shared helper to execute a request against the Supabase PostgREST endpoint.
 * Throws SupabaseRequestError with status, code, details, and hint on failure.
 * Raw response bodies are logged to console.error, never carried in error.message.
 */
async function executeSupabaseRequest({
  baseUrl,
  serviceRoleKey,
  path,
  options = {},
  fetchFn,
}) {
  const doFetch = fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (typeof doFetch !== 'function') {
    throw new Error('global fetch is unavailable');
  }

  const cleanBase = baseUrl ? baseUrl.replace(/\/$/, '') : '';
  const url = `${cleanBase}/rest/v1/${path}`;

  const response = await doFetch(url, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    console.error(`Supabase request failed with status ${response.status}:`, text);
    const code = (body && body.code) || null;
    const details = (body && body.details) || null;
    const hint = (body && body.hint) || null;
    throw new SupabaseRequestError({
      status: response.status,
      code,
      details,
      hint,
      body,
    });
  }

  if (!text) {
    return null;
  }
  if (body === null) {
    throw new Error('Supabase returned a non-JSON response');
  }
  return body;
}

/**
 * Recognizes a PostgreSQL unique violation constraint error (23505 or HTTP 409 Conflict).
 * Keys on code === '23505' and on status === 409, avoiding message substring inspection.
 */
function isPostgresUniqueViolation(error) {
  if (!error) return false;
  const code = error.code || error.body?.code;
  const status = error.status || error.response?.status;
  return code === '23505' || status === 409;
}

module.exports = {
  SupabaseRequestError,
  executeSupabaseRequest,
  isPostgresUniqueViolation,
};
