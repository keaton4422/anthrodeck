// Pure, side-effect-free helpers for the agent loop.
// Kept in their own module so they can be unit-tested headlessly (no Electron, no SDK client).

// ─── Session token accounting ─────────────────────────────────────────────────
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
}

export function emptyUsage(): SessionUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    thinkingTokens: 0,
  };
}

// Shape of the SDK `message.usage` object (only the fields we read; all optional/nullable so
// the helper tolerates older payloads and partial mocks).
export interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens_details?: { thinking_tokens?: number | null } | null;
}

// Fold one message's usage into a running session total. The agent loop calls the model multiple
// times per user turn (once per tool round-trip); prior code overwrote per call, so cumulative
// cost and cache savings were lost. This sums instead.
export function accumulateUsage(prev: SessionUsage, usage: RawUsage | null | undefined): SessionUsage {
  if (!usage) return prev;
  return {
    inputTokens: prev.inputTokens + (usage.input_tokens ?? 0),
    outputTokens: prev.outputTokens + (usage.output_tokens ?? 0),
    cacheReadTokens: prev.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
    cacheCreationTokens: prev.cacheCreationTokens + (usage.cache_creation_input_tokens ?? 0),
    thinkingTokens: prev.thinkingTokens + (usage.output_tokens_details?.thinking_tokens ?? 0),
  };
}

// ─── Tool-use extraction ──────────────────────────────────────────────────────
export interface ExtractedToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Pull the tool_use blocks out of an assistant message's content array. We read them from the
// SDK's final (already-parsed) message content rather than reassembling streamed input_json
// deltas by hand — that keeps thinking blocks and their signatures intact for multi-turn replay.
export function extractToolUses(content: unknown): ExtractedToolUse[] {
  if (!Array.isArray(content)) return [];
  const out: ExtractedToolUse[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'tool_use'
    ) {
      const b = block as { id?: unknown; name?: unknown; input?: unknown };
      if (typeof b.id === 'string' && typeof b.name === 'string') {
        out.push({
          id: b.id,
          name: b.name,
          input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>,
        });
      }
    }
  }
  return out;
}

// ─── Assistant text + confidence ──────────────────────────────────────────────
// Join the text blocks of an assistant message's content into a single string.
export function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && typeof b === 'object' && (b as { type?: unknown }).type === 'text')
    .map((b) => String((b as { text?: unknown }).text ?? ''))
    .join('');
}

export type Confidence = 'high' | 'med' | 'low';

// We ask the model to end each turn with a <confidence>high|med|low</confidence> tag. Pull it off
// the end of the assistant text and return the cleaned text (tag removed) plus the parsed level.
// Uniform across models (works whether or not extended thinking is on).
export function parseConfidence(text: string): { confidence: Confidence | null; cleaned: string } {
  const re = /\s*<confidence>\s*(high|medium|med|low)\s*<\/confidence>\s*$/i;
  const m = text.match(re);
  if (!m || m.index === undefined) return { confidence: null, cleaned: text };
  const raw = m[1].toLowerCase();
  const confidence: Confidence = raw === 'high' ? 'high' : raw === 'low' ? 'low' : 'med';
  return { confidence, cleaned: text.slice(0, m.index).replace(/\s+$/, '') };
}

// First sentence (or a capped prefix) of the model's narration — used as the one-line "why" shown
// before a tool runs in teach mode.
export function firstSentence(text: string, cap = 160): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^.*?[.!?](\s|$)/);
  const first = (m ? m[0] : trimmed).trim();
  return first.length > cap ? `${first.slice(0, cap - 1).trimEnd()}…` : first;
}

// ─── Model / thinking configuration ───────────────────────────────────────────
export const MODELS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'] as const;
export type ModelId = (typeof MODELS)[number];
export const DEFAULT_MODEL: ModelId = 'claude-sonnet-5';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = 'high';

export function isModelId(v: unknown): v is ModelId {
  return typeof v === 'string' && (MODELS as readonly string[]).includes(v);
}

export function isEffort(v: unknown): v is Effort {
  return typeof v === 'string' && (EFFORTS as readonly string[]).includes(v);
}

export interface InferenceConfig {
  model: string;
  extendedThinking: boolean;
  effort: string;
}

// Normalize whatever came off the wire / out of electron-store into a safe, valid config.
export function resolveInferenceConfig(raw: Partial<InferenceConfig> | null | undefined): {
  model: ModelId;
  extendedThinking: boolean;
  effort: Effort;
} {
  return {
    model: isModelId(raw?.model) ? raw!.model : DEFAULT_MODEL,
    extendedThinking: !!raw?.extendedThinking,
    effort: isEffort(raw?.effort) ? raw!.effort : DEFAULT_EFFORT,
  };
}
