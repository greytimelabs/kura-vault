import { describe, expect, it } from 'vitest';
import { ServerUrlError, apiBaseOf, hostOf, parseServerUrl } from '../../src/lib/serverUrl';

describe('parseServerUrl', () => {
  it('assumes https when no scheme is typed', () => {
    expect(parseServerUrl('vault.example.com')).toBe('https://vault.example.com');
  });

  it('strips whitespace, trailing slashes and the API prefix', () => {
    expect(parseServerUrl('  https://Vault.Example.com/  ')).toBe('https://vault.example.com');
    expect(parseServerUrl('https://vault.example.com/api/v1')).toBe('https://vault.example.com');
    expect(parseServerUrl('https://vault.example.com/api/v1/')).toBe('https://vault.example.com');
  });

  it('keeps a port and a sub-path', () => {
    expect(parseServerUrl('https://example.com:8443/vault/')).toBe('https://example.com:8443/vault');
  });

  it('allows http only for this machine', () => {
    expect(parseServerUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(parseServerUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(parseServerUrl('http://[::1]:3000')).toBe('http://[::1]:3000');
    for (const input of ['http://example.com', 'http://192.168.1.8:3000', 'http://vault.local']) {
      expect(() => parseServerUrl(input)).toThrow(ServerUrlError);
    }
  });

  it('rejects what is not a server address', () => {
    for (const input of ['', '   ', 'ftp://example.com', 'https://user:pw@example.com', 'https://']) {
      expect(() => parseServerUrl(input)).toThrow(ServerUrlError);
    }
  });
});

describe('helpers', () => {
  it('builds the API base and the display host', () => {
    expect(apiBaseOf('https://example.com:8443/vault')).toBe('https://example.com:8443/vault/api/v1');
    expect(hostOf('https://example.com:8443/vault')).toBe('example.com:8443');
  });
});
