// Finds the Claude Code binary AnthroDeck drives.
//
// The SDK can bundle a ~275 MB native binary per platform. We deliberately do NOT ship it inside
// the AppImage: it would make every in-app update a 300 MB download and freeze Claude Code at
// whatever version the cockpit was built with. Instead the engine is installed once with the
// official installer (into ~/.local/bin) and updates itself, independently of the cockpit.
//
// In development the SDK's own platform package is in node_modules, so `npm start` works with no
// global install.

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import nodePath from 'path';

export type EngineSource = 'override' | 'installer' | 'path' | 'bundled';

export interface EngineLocation {
  path: string;
  source: EngineSource;
}

export interface LocateDeps {
  home: string;
  envPath: string;
  platform: NodeJS.Platform;
  arch: string;
  exists: (p: string) => boolean;
  // Root to look for the SDK's platform package under (dev only).
  devRoot: string | null;
}

export const INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';

export function candidatePaths(override: string | null, d: LocateDeps): EngineLocation[] {
  // Join with the TARGET platform's rules, not the host's, so the lookup is deterministic and the
  // tests mean the same thing on every CI runner.
  const path = d.platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const exe = d.platform === 'win32' ? 'claude.exe' : 'claude';
  const out: EngineLocation[] = [];
  if (override) out.push({ path: override, source: 'override' });
  out.push({ path: path.join(d.home, '.local', 'bin', exe), source: 'installer' });
  out.push({ path: path.join(d.home, '.claude', 'local', exe), source: 'installer' });
  for (const dir of d.envPath.split(path.delimiter).filter(Boolean)) {
    out.push({ path: path.join(dir, exe), source: 'path' });
  }
  if (d.devRoot) {
    out.push({
      path: path.join(d.devRoot, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${d.platform}-${d.arch}`, exe),
      source: 'bundled',
    });
  }
  return out;
}

export function locateEngine(override: string | null, d: LocateDeps): EngineLocation | null {
  return candidatePaths(override, d).find((c) => d.exists(c.path)) ?? null;
}

export function defaultLocateDeps(devRoot: string | null): LocateDeps {
  return {
    home: os.homedir(),
    // Steam launches AppImages with a minimal PATH; ~/.local/bin is checked explicitly above.
    envPath: process.env.PATH ?? '',
    platform: process.platform,
    arch: process.arch,
    exists: (p) => {
      try { return fs.statSync(p).isFile(); } catch { return false; }
    },
    devRoot,
  };
}

export function engineVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.trim().split('\n')[0] || null);
    });
  });
}

// Whether Claude Code is signed in on this machine, and as whom. Claude Code records the signed-in
// account in ~/.claude.json (`oauthAccount`); with it, no API key is needed. Read-only and offline.
export interface ClaudeSignIn {
  signedIn: boolean;
  email: string | null;
  org: string | null;
}

export function readClaudeSignIn(claudeJson: string | null): ClaudeSignIn {
  const none = { signedIn: false, email: null, org: null };
  if (!claudeJson) return none;
  try {
    const acct = (JSON.parse(claudeJson) as { oauthAccount?: Record<string, unknown> }).oauthAccount;
    if (!acct || typeof acct !== 'object') return none;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return { signedIn: true, email: str(acct.emailAddress), org: str(acct.organizationName) };
  } catch {
    return none;
  }
}
