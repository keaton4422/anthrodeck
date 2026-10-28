// The cockpit screens' shared look and names: Home, the live session screen, the folder picker.

export const C = {
  panel: '#151515',
  line: '#262626',
  text: '#ECECEC',
  dim: '#8A8A8A',
  faint: '#5E5E5E',
  clay: '#D97757',
  clayBg: 'rgba(217,119,87,0.10)',
  green: '#52A77C',
  amber: '#D9A35B',
  red: '#E05252',
};

export const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

// Where a live session on the remote computer runs, in Claude Desktop's words.
export const liveSource = (entrypoint: string | null) =>
  entrypoint === 'claude-desktop' ? 'Claude app' : entrypoint === 'cli' ? 'terminal' : 'another app';
