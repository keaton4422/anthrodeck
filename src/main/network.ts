// LAN address selection. Kept pure (takes the os.networkInterfaces() result as an argument) so it
// can be unit-tested with mock interface tables — no real network needed.

export interface IfaceAddr {
  address: string;
  family: string | number;
  internal: boolean;
}

// Interface names that are usually virtual / not the real LAN link. Deprioritized, not excluded
// (in case one of them is genuinely all that's available).
const VIRTUAL_HINTS = [
  'loopback', 'docker', 'veth', 'vmware', 'virtualbox', 'vbox', 'wsl', 'hyper-v', 'hyperv',
  'bluetooth', 'tailscale', 'zerotier', 'utun', 'tun', 'tap', 'npcap', 'radmin',
];

function isIPv4(family: string | number): boolean {
  return family === 'IPv4' || family === 4;
}

// Higher is better. Real private LAN ranges score highest; link-local (169.254) is a last resort.
function rangeScore(addr: string): number {
  if (addr.startsWith('192.168.')) return 4;
  if (addr.startsWith('10.')) return 3;
  const m = addr.match(/^172\.(\d+)\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return 3;
  }
  if (addr.startsWith('169.254.')) return -5; // link-local, no real routing
  return 1;
}

function nameScore(name: string): number {
  const lower = name.toLowerCase();
  return VIRTUAL_HINTS.some((h) => lower.includes(h)) ? -3 : 0;
}

// Pick the best non-internal IPv4 LAN address, or null if there is none. We don't have the route
// table, so we approximate "the interface with a default route" by preferring real private ranges
// on non-virtual interfaces.
export function pickLanIp(
  interfaces: Record<string, IfaceAddr[] | undefined>,
): string | null {
  let best: { addr: string; score: number; order: number } | null = null;
  let order = 0;

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const info of addrs) {
      if (info.internal || !isIPv4(info.family)) continue;
      const score = rangeScore(info.address) + nameScore(name);
      const candidate = { addr: info.address, score, order: order++ };
      if (!best || candidate.score > best.score) best = candidate;
    }
  }

  return best ? best.addr : null;
}

// Parse a dev-server port out of a command's stdout. Dev servers announce themselves in a handful
// of shapes — Vite's "Local: http://localhost:5173/", Next's "started server on 0.0.0.0:3000",
// generic "listening on port 4321". Pure so it can be unit-tested against real banner text.
export function detectDevPortFromOutput(output: string): number | null {
  if (!output) return null;

  const patterns: RegExp[] = [
    // http://localhost:5173 / http://127.0.0.1:3000 / http://0.0.0.0:8080
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/gi,
    // "listening on port 4321" / "server on port 3000"
    /\bon port\s+(\d{2,5})\b/gi,
    // "started server on 0.0.0.0:3000"
    /\bserver on\s+[\w.:]*?:(\d{2,5})\b/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output)) !== null) {
      const port = Number(m[1]);
      if (Number.isInteger(port) && port >= 1024 && port <= 65535) return port;
    }
  }
  return null;
}

// Choose the port to bind: a valid 1024-65535 integer, else the default.
export function normalizePort(raw: unknown, fallback = 5757): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (Number.isInteger(n) && n >= 1024 && n <= 65535) return n;
  return fallback;
}
