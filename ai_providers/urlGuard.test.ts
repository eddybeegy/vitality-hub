import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertSafeProviderUrl } from './urlGuard';

// Mock the dns module so tests don't make real network calls.
vi.mock('dns', () => ({
  default: {
    lookup: (
      _host: string,
      _opts: object,
      cb: (err: Error | null, addrs: { address: string; family: number }[]) => void
    ) => {
      cb(null, [{ address: '93.184.216.34', family: 4 }]); // example.com
    },
  },
}));

describe('assertSafeProviderUrl', () => {
  describe('rejects invalid URLs', () => {
    it('throws on unparseable URL', async () => {
      await expect(assertSafeProviderUrl('not a url')).rejects.toThrow('Invalid provider URL');
    });

    it('throws on ftp:// scheme', async () => {
      await expect(assertSafeProviderUrl('ftp://example.com/v1')).rejects.toThrow(
        'must use http or https'
      );
    });

    it('throws on file:// scheme', async () => {
      await expect(assertSafeProviderUrl('file:///etc/passwd')).rejects.toThrow(
        'must use http or https'
      );
    });
  });

  describe('rejects private/loopback IP literals', () => {
    const privateAddresses = [
      'http://127.0.0.1/v1',
      'http://10.0.0.1/v1',
      'http://172.16.0.1/v1',
      'http://172.31.255.255/v1',
      'http://192.168.1.1/v1',
      'http://169.254.169.254/v1', // cloud metadata endpoint
      'http://0.0.0.0/v1',
      'http://100.64.0.1/v1',      // carrier-grade NAT
    ];

    for (const url of privateAddresses) {
      it(`blocks ${url}`, async () => {
        await expect(assertSafeProviderUrl(url)).rejects.toThrow(
          'disallowed (private) address'
        );
      });
    }
  });

  describe('rejects private IPv6 literals', () => {
    it('blocks ::1 (loopback)', async () => {
      await expect(assertSafeProviderUrl('http://[::1]/v1')).rejects.toThrow(
        'disallowed (private) address'
      );
    });

    it('blocks fe80:: (link-local)', async () => {
      await expect(assertSafeProviderUrl('http://[fe80::1]/v1')).rejects.toThrow(
        'disallowed (private) address'
      );
    });

    it('blocks fd00:: (unique-local)', async () => {
      await expect(assertSafeProviderUrl('http://[fd00::1]/v1')).rejects.toThrow(
        'disallowed (private) address'
      );
    });
  });

  describe('allows public URLs', () => {
    it('passes for https://api.openai.com', async () => {
      await expect(
        assertSafeProviderUrl('https://api.openai.com/v1')
      ).resolves.toBeUndefined();
    });

    it('passes for http://example.com (hostname resolved via mock to public IP)', async () => {
      await expect(
        assertSafeProviderUrl('http://example.com/v1')
      ).resolves.toBeUndefined();
    });
  });

  describe('allowPrivate flag bypasses IP check', () => {
    it('allows http://localhost when allowPrivate=true', async () => {
      // localhost resolves but allowPrivate skips the check entirely
      await expect(
        assertSafeProviderUrl('http://localhost:11434/v1', true)
      ).resolves.toBeUndefined();
    });

    it('allows a private IP when allowPrivate=true', async () => {
      await expect(
        assertSafeProviderUrl('http://192.168.1.100/v1', true)
      ).resolves.toBeUndefined();
    });
  });
});
