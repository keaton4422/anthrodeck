// Translates Claude Code's SDK message stream into the cockpit's event vocabulary. Stateful only in
// a small, explicit TranslateState, so the whole mapping is exercised by feeding it recorded
// messages in tests — no engine process needed.

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { parseConfidence, type Confidence } from './config';
import { isQuietTool, milestoneFor, toolLabel, type Milestone } from './tools';

// Token and cost figures are SESSION totals (Claude Code reports running totals on every result),
// so consumers replace rather than accumulate. durationMs / toolCalls / confidence are per turn.
export interface TurnSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
  costUsd: number;
  durationMs: number;
  toolCalls: number;
  confidence: Confidence | null;
  // Last assistant message uuid of the turn — where a rewind to this turn resumes from.
  anchor: string | null;
  isError: boolean;
  errors: string[];
}

export type CockpitEvent =
  | { type: 'session'; sessionId: string; model: string; cwd: string }
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; name: string; label: string; input: Record<string, unknown>; quiet: boolean }
  | { type: 'tool-result'; id: string; name: string; ok: boolean }
  | { type: 'milestone'; kind: Milestone; command: string }
  | { type: 'compacted'; preTokens: number; postTokens: number | null }
  | { type: 'retry'; attempt: number; maxRetries: number; delayMs: number }
  | { type: 'result'; summary: TurnSummary };

export interface TranslateState {
  root: string;
  // Text streamed in the current assistant message, for teach mode's "why".
  narration: string;
  // Final text of the turn (parsed for confidence).
  lastText: string;
  lastAssistantUuid: string | null;
  toolCalls: number;
  // tool_use id → name/input, so a tool_result can be matched back to what ran.
  pending: Map<string, { name: string; input: Record<string, unknown> }>;
}

export function newTranslateState(root: string): TranslateState {
  return { root, narration: '', lastText: '', lastAssistantUuid: null, toolCalls: 0, pending: new Map() };
}

type Block = { type: string; [k: string]: unknown };
const blocks = (content: unknown): Block[] =>
  Array.isArray(content) ? (content as Block[]).filter((b) => b && typeof b === 'object') : [];

export function translate(msg: SDKMessage, st: TranslateState): CockpitEvent[] {
  const out: CockpitEvent[] = [];

  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init') {
        out.push({ type: 'session', sessionId: msg.session_id, model: msg.model, cwd: msg.cwd });
      } else if (msg.subtype === 'compact_boundary') {
        out.push({
          type: 'compacted',
          preTokens: msg.compact_metadata.pre_tokens,
          postTokens: msg.compact_metadata.post_tokens ?? null,
        });
      } else if (msg.subtype === 'api_retry') {
        out.push({ type: 'retry', attempt: msg.attempt, maxRetries: msg.max_retries, delayMs: msg.retry_delay_ms });
      }
      break;
    }

    case 'stream_event': {
      // Subagent chatter stays off the main bubble; its tool calls still surface below.
      if (msg.parent_tool_use_id) break;
      const ev = msg.event;
      if (ev.type === 'message_start') st.narration = '';
      if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') {
          st.narration += ev.delta.text;
          out.push({ type: 'delta', text: ev.delta.text });
        } else if (ev.delta.type === 'thinking_delta') {
          out.push({ type: 'thinking', text: ev.delta.thinking });
        }
      }
      break;
    }

    case 'assistant': {
      if (!msg.parent_tool_use_id) {
        st.lastAssistantUuid = msg.uuid;
        const text = blocks(msg.message.content)
          .filter((b) => b.type === 'text')
          .map((b) => String(b.text ?? ''))
          .join('');
        if (text) st.lastText = text;
      }
      for (const b of blocks(msg.message.content)) {
        if (b.type !== 'tool_use') continue;
        const id = String(b.id ?? '');
        const name = String(b.name ?? '');
        const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
        st.pending.set(id, { name, input });
        st.toolCalls += 1;
        out.push({ type: 'tool', id, name, input, label: toolLabel(name, input, st.root), quiet: isQuietTool(name) });
      }
      break;
    }

    case 'user': {
      for (const b of blocks(msg.message.content)) {
        if (b.type !== 'tool_result') continue;
        const id = String(b.tool_use_id ?? '');
        const call = st.pending.get(id);
        if (!call) continue;
        st.pending.delete(id);
        const ok = !b.is_error;
        out.push({ type: 'tool-result', id, name: call.name, ok });
        if (call.name === 'Bash') {
          const command = String(call.input.command ?? '');
          const kind = milestoneFor(command, ok);
          if (kind) out.push({ type: 'milestone', kind, command });
        }
      }
      break;
    }

    case 'result': {
      // modelUsage is the session's running total across every model call (subagents and
      // compaction included); `usage` is main-loop-only and per-turn. The HUD wants the former.
      const totals = Object.values(msg.modelUsage ?? {}).reduce(
        (acc, m) => ({
          inputTokens: acc.inputTokens + (m.inputTokens ?? 0),
          outputTokens: acc.outputTokens + (m.outputTokens ?? 0),
          cacheReadTokens: acc.cacheReadTokens + (m.cacheReadInputTokens ?? 0),
          cacheCreationTokens: acc.cacheCreationTokens + (m.cacheCreationInputTokens ?? 0),
          thinkingTokens: acc.thinkingTokens + (m.thinkingTokens ?? 0),
        }),
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, thinkingTokens: 0 },
      );
      const finalText = msg.subtype === 'success' ? msg.result || st.lastText : st.lastText;
      out.push({
        type: 'result',
        summary: {
          ...totals,
          costUsd: msg.total_cost_usd ?? 0,
          durationMs: msg.duration_ms ?? 0,
          toolCalls: st.toolCalls,
          confidence: parseConfidence(finalText).confidence,
          anchor: st.lastAssistantUuid,
          isError: msg.is_error,
          // A failed turn with no structured errors (e.g. "Not logged in") carries its reason as
          // the turn's text — surface that rather than an empty failure.
          errors: (() => {
            const errs = msg.subtype === 'success' ? [] : msg.errors ?? [];
            if (msg.is_error && errs.length === 0 && finalText.trim()) return [finalText.trim()];
            return errs;
          })(),
        },
      });
      st.toolCalls = 0;
      st.lastText = '';
      st.pending.clear();
      break;
    }

    default:
      break;
  }

  return out;
}
