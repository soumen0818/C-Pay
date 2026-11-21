'use strict';

const {
  buildEqFilter,
  buildOwnerFilterQueries,
  mergeRowsById,
} = require('../postgrestFilters');

const WALLET = 'GDUXXBTQHTSNMHFKO2BNUQNQUCVIOKEMMKD5AWIFYBKOAVMFHBUP3RYJ';
const USER = '6f1c2d4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

/** Decode a query string the way PostgREST does before parsing filters. */
function decodedParams(params) {
  return new URLSearchParams(params.toString());
}

describe('postgrestFilters (#159)', () => {
  describe('buildEqFilter', () => {
    it('produces a single column=eq.value pair merged with base params', () => {
      const params = buildEqFilter('wallet_address', WALLET, { select: 'id,amount', order: 'created_at.asc' });
      expect(params.get('wallet_address')).toBe(`eq.${WALLET}`);
      expect(params.get('select')).toBe('id,amount');
      expect(params.get('order')).toBe('created_at.asc');
    });

    it('never emits a logical or=/and= group, even for injection payloads', () => {
      const payload = 'x,auth_user_id.not.is.null';
      const params = decodedParams(buildEqFilter('wallet_address', payload));
      expect(params.has('or')).toBe(false);
      expect(params.has('and')).toBe(false);
      expect(params.has('auth_user_id')).toBe(false);
      // After decoding, the whole payload is still the literal eq operand of one column.
      expect(params.get('wallet_address')).toBe(`eq.${payload}`);
      expect(Array.from(params.keys())).toEqual(['wallet_address']);
    });

    it('cannot smuggle extra query parameters through & or =', () => {
      const payload = `${WALLET}&auth_user_id=not.is.null`;
      const params = decodedParams(buildEqFilter('wallet_address', payload));
      expect(Array.from(params.keys())).toEqual(['wallet_address']);
      expect(params.get('wallet_address')).toBe(`eq.${payload}`);
    });

    it('overrides a base param with the same column instead of duplicating it', () => {
      const params = buildEqFilter('auth_user_id', USER, { auth_user_id: 'not.is.null' });
      expect(params.getAll('auth_user_id')).toEqual([`eq.${USER}`]);
    });

    it.each([
      [undefined],
      [null],
      [''],
      [42],
      [['a', 'b']],
      ['abc\u0000def'],
    ])('rejects invalid value %p', (value) => {
      expect(() => buildEqFilter('wallet_address', value)).toThrow(TypeError);
    });

    it.each([
      ['or'],
      ['and'],
      ['select'],
      ['wallet_address,auth_user_id'],
      ['Wallet'],
      [''],
    ])('rejects invalid column %p', (column) => {
      expect(() => buildEqFilter(column, WALLET)).toThrow(TypeError);
    });

    it('rejects base params containing logical filter groups', () => {
      expect(() => buildEqFilter('wallet_address', WALLET, { or: '(a.eq.1,b.eq.2)' })).toThrow(TypeError);
    });
  });

  describe('buildOwnerFilterQueries', () => {
    it('builds one query per present owner column', () => {
      const queries = buildOwnerFilterQueries({ authUserId: USER, walletAddress: WALLET }, { select: 'id' });
      expect(queries).toHaveLength(2);
      expect(queries[0].get('auth_user_id')).toBe(`eq.${USER}`);
      expect(queries[0].has('wallet_address')).toBe(false);
      expect(queries[1].get('wallet_address')).toBe(`eq.${WALLET}`);
      expect(queries[1].has('auth_user_id')).toBe(false);
      for (const query of queries) {
        expect(query.has('or')).toBe(false);
        expect(query.get('select')).toBe('id');
      }
    });

    it('skips absent owners', () => {
      expect(buildOwnerFilterQueries({ authUserId: USER })).toHaveLength(1);
      expect(buildOwnerFilterQueries({ walletAddress: WALLET })).toHaveLength(1);
    });

    it('refuses an unscoped lookup instead of querying wallet_address=eq.undefined', () => {
      expect(() => buildOwnerFilterQueries({})).toThrow(TypeError);
      expect(() => buildOwnerFilterQueries({ authUserId: null, walletAddress: null })).toThrow(TypeError);
      expect(() => buildOwnerFilterQueries()).toThrow(TypeError);
    });
  });

  describe('mergeRowsById', () => {
    it('de-duplicates rows matched by more than one owner column and sorts them', () => {
      const merged = mergeRowsById(
        [
          [{ id: 'b', t: 2 }, { id: 'a', t: 1 }],
          [{ id: 'a', t: 1 }, { id: 'c', t: 3 }],
        ],
        row => row.t
      );
      expect(merged.map(r => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('throws on non-array result sets or rows without ids', () => {
      expect(() => mergeRowsById([null])).toThrow();
      expect(() => mergeRowsById([[{ amount: 1 }]])).toThrow();
    });
  });
});
