import { describe, it, expect } from 'vitest';
import { pickLanIp, normalizePort } from '../network';
import { pickServeDir, OUTPUT_DIRS } from '../previewServer';

describe('pickLanIp', () => {
  it('picks a real private LAN IPv4 over loopback and virtual interfaces', () => {
    const ifaces = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      'vEthernet (WSL)': [{ address: '172.20.1.1', family: 'IPv4', internal: false }],
      wlan0: [{ address: '192.168.1.42', family: 'IPv4', internal: false }],
    };
    expect(pickLanIp(ifaces)).toBe('192.168.1.42');
  });

  it('prefers 192.168 over a docker 172 range', () => {
    const ifaces = {
      docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
      eth0: [{ address: '192.168.0.10', family: 'IPv4', internal: false }],
    };
    expect(pickLanIp(ifaces)).toBe('192.168.0.10');
  });

  it('accepts numeric family (older node)', () => {
    const ifaces = {
      eth0: [{ address: '10.0.0.5', family: 4, internal: false }],
    };
    expect(pickLanIp(ifaces)).toBe('10.0.0.5');
  });

  it('avoids link-local 169.254 unless nothing else exists', () => {
    const both = {
      eth0: [{ address: '169.254.9.9', family: 'IPv4', internal: false }],
      wlan0: [{ address: '10.1.2.3', family: 'IPv4', internal: false }],
    };
    expect(pickLanIp(both)).toBe('10.1.2.3');

    const only = {
      eth0: [{ address: '169.254.9.9', family: 'IPv4', internal: false }],
    };
    expect(pickLanIp(only)).toBe('169.254.9.9');
  });

  it('ignores IPv6 and returns null when there is no external IPv4', () => {
    const ifaces = {
      lo: [{ address: '::1', family: 'IPv6', internal: true }],
      eth0: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
    };
    expect(pickLanIp(ifaces)).toBeNull();
  });
});

describe('normalizePort', () => {
  it('accepts valid ports in range', () => {
    expect(normalizePort(5757)).toBe(5757);
    expect(normalizePort('8080')).toBe(8080);
    expect(normalizePort(1024)).toBe(1024);
    expect(normalizePort(65535)).toBe(65535);
  });

  it('falls back for out-of-range / garbage / missing', () => {
    expect(normalizePort(80)).toBe(5757);
    expect(normalizePort(99999)).toBe(5757);
    expect(normalizePort('abc')).toBe(5757);
    expect(normalizePort(undefined)).toBe(5757);
    expect(normalizePort(null, 3000)).toBe(3000);
  });
});

describe('pickServeDir', () => {
  it('returns the first existing candidate in priority order', () => {
    const present = new Set(['/proj/out', '/proj/build']);
    const exists = (p: string) => present.has(p.replace(/\\/g, '/'));
    // dist missing, out present -> out wins (out precedes build in OUTPUT_DIRS)
    expect(pickServeDir('/proj', OUTPUT_DIRS, exists)?.replace(/\\/g, '/')).toBe('/proj/out');
  });

  it('returns null when no candidate exists', () => {
    expect(pickServeDir('/proj', OUTPUT_DIRS, () => false)).toBeNull();
  });

  it('honors the documented priority (dist before out)', () => {
    const present = new Set(['/proj/dist', '/proj/out']);
    const exists = (p: string) => present.has(p.replace(/\\/g, '/'));
    expect(pickServeDir('/proj', OUTPUT_DIRS, exists)?.replace(/\\/g, '/')).toBe('/proj/dist');
  });
});
