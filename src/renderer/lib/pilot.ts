// Pure helpers for the human-as-pilot UI (token HUD + tool-line collapsing). No React, no
// Electron — unit-testable in isolation.

// Rough client-side token estimate (~4 chars/token). This is a display heuristic for the context
// inspector, not a billing figure — the real per-turn counts come from the API usage on claude:done.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export type BudgetLevel = 'ok' | 'warn' | 'crit';

// Green until 70% of the soft budget, yellow to 90%, red past that.
export function budgetLevel(used: number, budget: number): BudgetLevel {
  if (budget <= 0) return 'ok';
  const ratio = used / budget;
  if (ratio >= 0.9) return 'crit';
  if (ratio >= 0.7) return 'warn';
  return 'ok';
}

export const BUDGET_COLORS: Record<BudgetLevel, string> = {
  ok: '#52A77C',
  warn: '#D9A441',
  crit: '#E05252',
};

// Fraction of budget used, clamped to [0, 1] for the bar width.
export function budgetFraction(used: number, budget: number): number {
  if (budget <= 0) return 0;
  return Math.min(1, Math.max(0, used / budget));
}

// Compact "12.3K" / "1.2M" style formatting for the HUD.
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// Inline tool-activity lines the engine appends to an assistant bubble, e.g. `read: src/App.tsx`,
// `$ npm test`, `✓ wrote: x.ts`. D-pad left collapses them so long tool runs stay readable. The
// prefixes mirror toolLabel() in main/engine/tools.ts — keep the two in sync.
const TOOL_LINE = /^\s*`(?:read:|write:|edit:|glob:|grep:|web:|ask:|agent:|plan:|tool:|list_files|\$ |✓ wrote:)[^`]*`\s*$/;

export function stripToolLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => !TOOL_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countToolLines(content: string): number {
  return content.split('\n').filter((line) => TOOL_LINE.test(line)).length;
}
