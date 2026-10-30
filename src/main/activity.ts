// What's been happening in each project, for the drawer: the branch and what isn't pushed or
// committed yet, the latest release tag and how much has landed since, and the last few commits.
// Read with git on whichever computer the project is on (python3 is on both the Mac and the Deck),
// from the local refs: nothing is fetched, so "unpushed" is as of the last fetch or push.

import { parseGitLog, type Commit } from './gitLog';
import { parseGitStatus, type GitState } from './sessions';

export interface ProjectActivity {
  cwd: string;
  name: string;
  git: GitState;
  release: { tag: string; at: number; since: number } | null;   // commits on HEAD since the tag
  today: number;                                                // commits in the last 24 hours
  commits: Commit[];                                            // newest first
}

export const ACTIVITY_PY = String.raw`
import json, os, subprocess, sys
def git(cwd, *args):
    r = subprocess.run(['git', '-C', cwd] + list(args), capture_output=True, text=True, timeout=5)
    return r.stdout if r.returncode == 0 else None
out = []
for cwd in json.loads(sys.argv[1]):
    status = git(cwd, 'status', '--porcelain=v1', '-b')
    if status is None: continue
    tag = (git(cwd, 'describe', '--tags', '--abbrev=0') or '').strip()
    out.append({
        'cwd': cwd,
        'status': status,
        'log': git(cwd, 'log', '-n', '5', '--pretty=format:%h%x1f%s%x1f%an%x1f%ct%x1f%D%x1e') or '',
        'tag': tag,
        'tagAt': (git(cwd, 'log', '-1', '--format=%ct', tag) or '0').strip() if tag else '0',
        'since': (git(cwd, 'rev-list', '--count', tag + '..HEAD') or '0').strip() if tag else '0',
        'today': (git(cwd, 'rev-list', '--count', '--since=24.hours', 'HEAD') or '0').strip(),
    })
print(json.dumps(out))
`;

export interface RawActivity { cwd: string; status: string; log: string; tag: string; tagAt: string; since: string; today: string }

export function toActivity(raw: RawActivity[]): ProjectActivity[] {
  return raw.map((r) => ({
    cwd: r.cwd,
    name: r.cwd.split(/[\\/]/).filter(Boolean).pop() ?? r.cwd,
    git: parseGitStatus(r.status),
    release: r.tag ? { tag: r.tag, at: Number(r.tagAt) * 1000, since: Number(r.since) || 0 } : null,
    today: Number(r.today) || 0,
    commits: parseGitLog(r.log),
  }));
}
