import { relayerRequest, RelayerRequestError } from '../../services/blockchain';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('C-003: relayerRequest retry and error behavior', () => {
  let timeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((cb: any, ms?: number) => {
      // Fast-forward backoff delays (2000ms, 4000ms) immediately
      if (ms && ms < 10000) {
        return setImmediate(cb) as any;
      }
      // Keep request timeout from firing during tests
      return 99999 as any;
    });
  });

  afterEach(() => {
    timeoutSpy.mockRestore();
  });

  test('retries on 502/503/504 cold-start errors and succeeds when next attempt returns 200', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ error: 'Bad Gateway' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, attempt: 2 }),
      });

    const result = await relayerRequest('/test-retry');
    expect(result).toEqual({ success: true, attempt: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('retries on network fetch rejection and succeeds on retry', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ recovered: true }),
      });

    const result = await relayerRequest('/test-net-err');
    expect(result).toEqual({ recovered: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('exhausts 3 attempts on continuous 503 errors and throws RelayerRequestError', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service Unavailable', code: 'SERVER_BUSY' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service Unavailable', code: 'SERVER_BUSY' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service Unavailable', code: 'SERVER_BUSY' }),
      });

    await expect(relayerRequest('/test-fail-503')).rejects.toThrow(RelayerRequestError);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test('does not retry 4xx errors (e.g. 400 Bad Request) and throws immediately', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Invalid parameter',
        code: 'INVALID_INPUT',
        retryAfterSeconds: 0,
      }),
    });

    await expect(relayerRequest('/test-400')).rejects.toThrow('Invalid parameter');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('does not retry 429 Too Many Requests and captures retryAfterSeconds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMITED',
        retryAfterSeconds: 60,
      }),
    });

    await expect(relayerRequest('/test-429')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 60,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('exhausts attempts on timeout AbortError and throws RELAYER_TIMEOUT', async () => {
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';

    mockFetch
      .mockRejectedValueOnce(abortErr)
      .mockRejectedValueOnce(abortErr)
      .mockRejectedValueOnce(abortErr);

    await expect(relayerRequest('/test-abort')).rejects.toMatchObject({
      code: 'RELAYER_TIMEOUT',
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
