const fs = require('fs');
const path = require('path');

/**
 * Extracts relayer route patterns called by the client in App/src
 */
function extractClientRelayerPaths(appSrcDir) {
  const paths = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== '__mocks__') {
          scanDir(fullPath);
        }
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js')) {
        const source = fs.readFileSync(fullPath, 'utf8');
        // Match relayerRequest calls, e.g. relayerRequest('/accounts/prepare') or relayerRequest(`/account/${accountId}/status`)
        const regex = /relayerRequest(?:<[^>]*>)?\s*\(\s*([`'"][^`'"]+[`'"])/g;
        let match;
        while ((match = regex.exec(source)) !== null) {
          const rawLiteral = match[1];
          // Strip enclosing quotes or backticks
          const unquoted = rawLiteral.slice(1, -1);
          // Normalize template literals: replace ${...} with :param
          const normalized = unquoted.replace(/\$\{[^}]+\}/g, ':param');
          paths.push({
            file: path.relative(appSrcDir, fullPath).replace(/\\/g, '/'),
            raw: unquoted,
            pattern: normalized,
          });
        }
      }
    }
  }

  scanDir(appSrcDir);
  return paths;
}

/**
 * Extracts registered route paths from server.js
 */
function extractServerRoutes(serverJsPath) {
  let targetPath = serverJsPath;
  const dir = path.dirname(serverJsPath);
  const appPath = path.join(dir, 'app.js');
  if (fs.existsSync(appPath)) {
    targetPath = appPath;
  }
  const source = fs.readFileSync(targetPath, 'utf8');
  const routes = [];
  // Match app.get(..., app.post(..., etc.
  const regex = /app\.(get|post|put|delete|patch)\(\s*(\[[^\]]+\]|['"][^'"]+['"])/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const rawTarget = match[2];
    if (rawTarget.startsWith('[')) {
      // Array of routes like ['/payments/limits', '/limits']
      const inner = rawTarget.slice(1, -1);
      const parts = inner.split(',').map(s => s.trim().slice(1, -1));
      routes.push(...parts);
    } else {
      routes.push(rawTarget.slice(1, -1));
    }
  }
  return routes;
}

/**
 * Checks if a normalized client path matches a server route definition
 */
function routeMatches(clientPattern, serverRoute) {
  // If exact match
  if (clientPattern === serverRoute) return true;

  // Split into segments
  const clientSegments = clientPattern.split('/').filter(Boolean);
  const serverSegments = serverRoute.split('/').filter(Boolean);

  if (clientSegments.length !== serverSegments.length) return false;

  for (let i = 0; i < clientSegments.length; i++) {
    const c = clientSegments[i];
    const s = serverSegments[i];
    // If server segment is a parameter like :accountId or :hash
    if (s.startsWith(':')) {
      // Client segment must be :param or non-empty value
      continue;
    }
    if (c !== s) {
      return false;
    }
  }

  return true;
}

if (typeof describe !== 'undefined') {
  describe('Client-Relayer Route Parity', () => {
  const appSrcDir = path.resolve(__dirname, '../../App/src');
  const serverJsPath = path.resolve(__dirname, '../server.js');

  test('extracts client calls from App/src', () => {
    const clientCalls = extractClientRelayerPaths(appSrcDir);
    expect(clientCalls.length).toBeGreaterThan(0);

    const patterns = clientCalls.map(c => c.pattern);
    expect(patterns).toContain('/accounts/prepare');
    expect(patterns).toContain('/accounts/submit');
    expect(patterns).toContain('/payments/submit');
    expect(patterns).toContain('/add-money');
    expect(patterns).toContain('/account/:param/status');
    expect(patterns).toContain('/account/:param/balance');
    expect(patterns).toContain('/tx/:param');
    expect(patterns).toContain('/payments/limits');
  });

  test('extracts registered routes from server.js', () => {
    const serverRoutes = extractServerRoutes(serverJsPath);
    expect(serverRoutes.length).toBeGreaterThan(0);
    expect(serverRoutes).toContain('/accounts/prepare');
    expect(serverRoutes).toContain('/accounts/submit');
    expect(serverRoutes).toContain('/payments/submit');
    expect(serverRoutes).toContain('/add-money');
    expect(serverRoutes).toContain('/account/:accountId/status');
    expect(serverRoutes).toContain('/account/:accountId/balance');
    expect(serverRoutes).toContain('/tx/:hash');
    expect(serverRoutes).toContain('/payments/limits');
  });

  test('all relayer paths called from App/src are registered routes in server.js', () => {
    const clientCalls = extractClientRelayerPaths(appSrcDir);
    const serverRoutes = extractServerRoutes(serverJsPath);

    const unmatched = [];
    for (const call of clientCalls) {
      const isMatched = serverRoutes.some(route => routeMatches(call.pattern, route));
      if (!isMatched) {
        unmatched.push(`${call.file}: ${call.raw} (pattern: ${call.pattern})`);
      }
    }

    expect(unmatched).toEqual([]);
  });

  test('fails when client calls a route that is not registered', () => {
    const serverRoutes = extractServerRoutes(serverJsPath);
    const fakeClientPattern = '/account/:param/nonexistent';
    const isMatched = serverRoutes.some(route => routeMatches(fakeClientPattern, route));
    expect(isMatched).toBe(false);
  });
  });
}

module.exports = {
  extractClientRelayerPaths,
  extractServerRoutes,
  routeMatches,
};
