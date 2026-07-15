// Pure helpers for the human-as-pilot UI (token HUD + context pruner). No React, no Electron —
// unit-testable in isolation.

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

interface PrunableMessage {
  id: string;
  role: string;
  content: string;
}

// Suggest messages whose work has been superseded: an assistant turn that read a file which a
// LATER assistant turn read again (the earlier read is stale context worth dropping). Tool reads
// surface inline as `read: <path>` activity labels in the assistant bubble.
export function suggestPrunes(messages: PrunableMessage[]): string[] {
  const readRe = /`read:\s*([^`\n]+)`/g;
  const lastReadAt = new Map<string, number>();

  messages.forEach((m, i) => {
    if (m.role !== 'assistant') return;
    readRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = readRe.exec(m.content)) !== null) {
      lastReadAt.set(match[1].trim(), i);
    }
  });

  const suggested: string[] = [];
  messages.forEach((m, i) => {
    if (m.role !== 'assistant') return;
    readRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = readRe.exec(m.content)) !== null) {
      const path = match[1].trim();
      if ((lastReadAt.get(path) ?? i) > i) {
        suggested.push(m.id);
        break;
      }
    }
  });

  return suggested;
}
