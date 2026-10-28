// The project's recent commits, for the drawer's Git tab: read with `git log` on whichever
// computer the project is on. The format puts unit separators between fields and a record
// separator between commits, so subjects with any punctuation parse cleanly.

export interface Commit {
  hash: string;          // short
  subject: string;
  author: string;
  at: number;            // epoch ms
  refs: string[];        // branches and tags pointing here ("HEAD -> main", "tag: v1.0" become "main", "v1.0")
}

export const GIT_LOG_ARGS = ['log', '-n', '40', '--pretty=format:%h%x1f%s%x1f%an%x1f%ct%x1f%D%x1e'];

export function parseGitLog(stdout: string): Commit[] {
  return stdout.split('\x1e').map((r) => r.replace(/^\s+/, '')).filter(Boolean).flatMap((rec) => {
    const [hash, subject, author, ct, refs] = rec.split('\x1f');
    if (!hash || !ct) return [];
    return [{
      hash, subject: subject ?? '', author: author ?? '', at: Number(ct) * 1000,
      refs: (refs ?? '').split(',').map((r) => r.trim().replace(/^HEAD -> /, '').replace(/^tag: /, ''))
        .filter((r) => r && r !== 'HEAD' && !r.startsWith('origin/HEAD')),
    }];
  });
}
