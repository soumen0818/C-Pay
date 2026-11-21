import fs from 'fs';
import path from 'path';

/**
 * #161: C-Pay IDs are assigned once by the database (allocate_cpay_id via the
 * assign_users_cpay_id trigger) and never written by the App. This guard scans
 * client source so a regression (generation, "self-heal", or passing cpay_id
 * in an insert/update/upsert payload) fails CI.
 */

const APP_SRC = path.resolve(__dirname, '../..');

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== '__mocks__' && entry.name !== 'node_modules') {
        collectSourceFiles(fullPath, files);
      }
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const sources = collectSourceFiles(APP_SRC).map(file => ({
  file: path.relative(APP_SRC, file).replace(/\\/g, '/'),
  source: fs.readFileSync(file, 'utf8'),
}));

describe('C-Pay ID is read-only on the client (#161)', () => {
  test('no client code puts cpay_id in a write payload', () => {
    // Matches object keys such as `cpay_id: value` or `'cpay_id': value`.
    // RPC parameters like `p_cpay_id` (lookups) are not matched.
    const payloadKey = /(^|[^A-Za-z0-9_])['"]?cpay_id['"]?\s*:/m;
    const offenders = sources.filter(({ source }) => payloadKey.test(source)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  test('no client code generates C-Pay IDs', () => {
    const generators = /\b(generateCPayId|generateCpayId|createCPayId|regenerateCPayId)\b|`[^`]*@cpay\$\{/;
    const offenders = sources.filter(({ source }) => generators.test(source)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  test('getCurrentUserCPayId only reads the stored ID', () => {
    const cpayIdModule = sources.find(({ file }) => file === 'utils/cpayId.ts');
    expect(cpayIdModule).toBeDefined();
    expect(cpayIdModule!.source).not.toMatch(/\.(update|upsert|insert)\s*\(/);
  });
});
