'use strict';

/**
 * Safe PostgREST filter construction (Issue #159).
 *
 * PostgREST URL-decodes the query string *before* it parses logical filters
 * such as `or=(a.eq.x,b.eq.y)`, so `encodeURIComponent` does not stop a value
 * containing `,` `(` `)` or `.` from injecting extra conditions into an
 * `or=(...)` / `and=(...)` group. A payload like `x,auth_user_id.not.is.null`
 * turns a per-user lookup into a platform-wide one.
 *
 * The rule enforced here: never build logical filter groups from untrusted
 * values. Every filter is a single `column=eq.<value>` pair placed through
 * URLSearchParams. For a plain column filter PostgREST treats everything after
 * the operator as the literal operand, so no value can add conditions.
 *
 * When a lookup needs "rows owned by user OR by wallet", callers run one query
 * per owner column and merge the results (see mergeRowsById).
 */

const COLUMN_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;
// Reserved query keys that must never be overwritten by a filter column.
const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'not', 'on_conflict', 'columns']);

function assertColumnName(column) {
  if (typeof column !== 'string' || !COLUMN_NAME_PATTERN.test(column) || RESERVED_PARAMS.has(column)) {
    throw new TypeError(`Invalid PostgREST filter column: ${String(column)}`);
  }
  return column;
}

function assertFilterValue(column, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Missing PostgREST filter value for ${column}`);
  }
  // Control characters have no place in identifiers we filter on.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`Invalid PostgREST filter value for ${column}`);
  }
  return value;
}

/**
 * Build URLSearchParams with a single `column=eq.value` filter merged with
 * optional base params (select, order, range filters, ...).
 *
 * @param {string} column
 * @param {string} value
 * @param {Record<string,string>|URLSearchParams} [baseParams]
 * @returns {URLSearchParams}
 */
function buildEqFilter(column, value, baseParams) {
  assertColumnName(column);
  assertFilterValue(column, value);

  const params = new URLSearchParams(baseParams || undefined);
  for (const key of params.keys()) {
    if (key === 'or' || key === 'and') {
      throw new TypeError('Logical filter groups are not allowed');
    }
  }
  params.set(column, `eq.${value}`);
  return params;
}

/**
 * Build one query per owner column. Absent owners are skipped; at least one
 * owner must be present so a lookup can never silently widen to every row
 * (e.g. `wallet_address=eq.undefined` or no filter at all).
 *
 * @param {{ authUserId?: string|null, walletAddress?: string|null }} owners
 * @param {Record<string,string>|URLSearchParams} [baseParams]
 * @returns {URLSearchParams[]}
 */
function buildOwnerFilterQueries({ authUserId, walletAddress } = {}, baseParams) {
  const queries = [];
  if (authUserId !== undefined && authUserId !== null) {
    queries.push(buildEqFilter('auth_user_id', authUserId, baseParams));
  }
  if (walletAddress !== undefined && walletAddress !== null) {
    queries.push(buildEqFilter('wallet_address', walletAddress, baseParams));
  }
  if (queries.length === 0) {
    throw new TypeError('An owner filter (auth_user_id or wallet_address) is required');
  }
  return queries;
}

/**
 * Merge result sets from several owner queries, de-duplicating rows that
 * matched more than one owner column. Rows must carry an `id`.
 *
 * @param {Array<Array<object>>} rowSets
 * @param {(row: object) => number} [sortKey] optional ascending sort key
 * @returns {object[]}
 */
function mergeRowsById(rowSets, sortKey) {
  const seen = new Map();
  for (const rows of rowSets) {
    if (!Array.isArray(rows)) {
      throw new Error('PostgREST lookup returned an invalid response');
    }
    for (const row of rows) {
      if (!row || row.id === undefined || row.id === null) {
        throw new Error('PostgREST lookup returned a row without an id');
      }
      if (!seen.has(row.id)) seen.set(row.id, row);
    }
  }
  const merged = Array.from(seen.values());
  if (typeof sortKey === 'function') {
    merged.sort((a, b) => sortKey(a) - sortKey(b));
  }
  return merged;
}

module.exports = {
  buildEqFilter,
  buildOwnerFilterQueries,
  mergeRowsById,
};
