import { IpcMainEvent, BrowserWindow } from 'electron';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  accumulateUsage,
  emptyUsage,
  extractToolUses,
  type Effort,
} from './agentLoop.helpers';

// ─── Tool definitions given to Claude ─────────────────────────────────────────
// The last tool carries a cache_control breakpoint so the whole tools array is cached as a unit
// (render order is tools -> system -> messages, so caching here + on the system block gives us a
// stable, reusable prefix). Keeping the tool list deterministic is what makes the cache hit.
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the project. Path is relative to project root.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path to the file, e.g. src/App.tsx' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file and any missing parent directories. Path is relative to project root. Always read the file first before overwriting.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path to the file, e.g. src/App.tsx' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories in the project. Returns a flat list of relative paths up to 3 levels deep.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dir: { type: 'string', description: 'Subdirectory to list (optional, defaults to project root)' },
      },
      required: [],
    },
  },
  {
    name: 'run_shell',
    description: 'Run a shell command in the project directory. Use for builds, tests, git operations, installs, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to run, e.g. "npm install" or "git status"' },
      },
      required: ['command'],
    },
    // Cache breakpoint on the final tool -> caches the entire tools array.
    cache_control: { type: 'ephemeral' },
  },
];

// ─── Helper: list files recursively up to maxDepth ────────────────────────────
function listFilesRecursive(dir: string, rootDir: string, depth = 0, maxDepth = 3): string[] {
  if (depth >= maxDepth) return [];
  const IGNORE = new Set(['node_modules', '.git', '.vite', 'out', 'dist', '.DS_Store', '__pycache__']);
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    const rel = path.relative(rootDir, path.join(dir, entry.name)).replace(/\\/g, '/');
    results.push(entry.isDirectory() ? `${rel}/` : rel);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(path.join(dir, entry.name), rootDir, depth + 1, maxDepth));
    }
  }
  return results;
}

// ─── Helper: execute tool calls that don't need user review ───────────────────
function execTool(
  name: string,
  input: Record<string, unknown>,
  projectPath: string,
): Promise<string> {
  return new Promise((resolve) => {
    if (name === 'read_file') {
      try {
        const abs = path.join(projectPath, String(input.path ?? ''));
        const content = fs.readFileSync(abs, 'utf-8');
        resolve(content);
      } catch (e) {
        resolve(`Error reading file: ${(e as Error).message}`);
      }
    } else if (name === 'list_files') {
      try {
        const base = input.dir ? path.join(projectPath, String(input.dir)) : projectPath;
        const files = listFilesRecursive(base, projectPath);
        resolve(files.join('\n') || '(empty directory)');
      } catch (e) {
        resolve(`Error listing files: ${(e as Error).message}`);
      }
    } else if (name === 'run_shell') {
      exec(String(input.command ?? ''), { cwd: projectPath, timeout: 60000 }, (err, stdout, stderr) => {
        const out = [stdout, stderr].filter(Boolean).join('\n');
        resolve(out || (err ? `Error: ${err.message}` : '(no output)'));
      });
    } else {
      resolve(`Unknown tool: ${name}`);
    }
  });
}

// ─── Helper: ask renderer to show write preview, wait for decision ─────────────
function askRendererForWrite(
  win: BrowserWindow,
  toolId: string,
  filePath: string,
  content: string,
): Promise<{ accepted: boolean; feedback?: string }> {
  return new Promise((resolve) => {
    const { ipcMain } = require('electron');

    const handler = (_: IpcMainEvent, id: string, accepted: boolean, feedback?: string) => {
      if (id !== toolId) return;
      ipcMain.removeListener('claude:write-decision', handler);
      resolve({ accepted, feedback });
    };

    ipcMain.on('claude:write-decision', handler);
    win.webContents.send('claude:write-preview', { id: toolId, path: filePath, content });
  });
}

// ─── Config passed from the renderer / settings ───────────────────────────────
export interface AgentLoopConfig {
  model: string;
  extendedThinking: boolean;
  effort: Effort;
}

// ─── Main agentic loop ─────────────────────────────────────────────────────────
export async function runAgentLoop(
  event: IpcMainEvent,
  messages: Anthropic.MessageParam[],
  apiKey: string,
  projectPath: string | null,
  autonomousWrites: boolean,
  config: AgentLoopConfig,
  win: BrowserWindow | null,
  abortRef: { aborted: boolean },
) {
  // maxRetries: the SDK already backs off 429/529 with jitter; bumping from the default 2 to 4
  // hardens bursty handheld usage. Default 10-minute timeout is left in place.
  const anthropic = new Anthropic({ apiKey, maxRetries: 4 });
  const effectivePath = projectPath ?? process.env.HOME ?? '/tmp';

  // Frozen system prompt (no per-request/volatile interpolation ahead of the cache breakpoint).
  const systemPrompt = `You are AntroDeck — an AI coding assistant built into a Steam Deck. You help the user code, create, deploy, and accomplish anything through voice and touch.

You have tools to work with the user's project${projectPath ? ` at: ${projectPath}` : ''}.
- Use list_files to explore the project structure
- Use read_file to understand code before modifying it
- Use write_file to apply changes to files
- Use run_shell for builds, tests, deploys, git operations, installs, etc.

Guidelines:
- Always read a file before overwriting it unless creating a new one
- Write complete file contents (not partial diffs) when using write_file
- Keep responses concise — the user reads on a handheld screen
- Be decisive and practical: make the change, don't just explain how to do it`;

  // Working copy of messages for the loop
  const loopMessages: Anthropic.MessageParam[] = [...messages];
  const MAX_ITERATIONS = 20;

  // Cumulative token usage across every model call in this user turn (input, output, cache read,
  // cache creation, thinking). Prior code overwrote per iteration; we sum.
  let sessionUsage = emptyUsage();

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (abortRef.aborted) {
      event.sender.send('claude:error', 'Aborted');
      return;
    }

    let finalMsg: Anthropic.Message;

    try {
      const streamParams: Anthropic.MessageStreamParams = {
        model: config.model,
        // Generous ceiling so adaptive thinking has room without truncating the answer (we stream,
        // so HTTP timeouts are not a concern).
        max_tokens: 32000,
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ],
        tools: projectPath ? TOOLS : [],
        messages: loopMessages,
        output_config: { effort: config.effort },
      };
      // Adaptive thinking replaces the deprecated budget_tokens knob (which now 400s on current
      // models). display: 'summarized' surfaces readable reasoning for the Phase 1 thinking HUD.
      if (config.extendedThinking) {
        streamParams.thinking = { type: 'adaptive', display: 'summarized' };
      }

      const stream = anthropic.messages.stream(streamParams);

      for await (const event_ of stream) {
        if (abortRef.aborted) break;

        if (event_.type === 'content_block_delta') {
          if (event_.delta.type === 'text_delta') {
            if (!event.sender.isDestroyed()) {
              event.sender.send('claude:delta', event_.delta.text);
            }
          } else if (event_.delta.type === 'thinking_delta') {
            // Extended-thinking reasoning stream. Phase 1 surfaces this in the UI; for now it is
            // forwarded on its own channel so nothing has to change here later.
            if (!event.sender.isDestroyed()) {
              event.sender.send('claude:thinking-delta', event_.delta.thinking);
            }
          }
        }
      }

      if (abortRef.aborted) {
        event.sender.send('claude:error', 'Aborted');
        return;
      }

      // The assembled message carries the full, already-parsed content — text, thinking blocks
      // (with signatures, needed to replay them on tool-use turns), and tool_use blocks — plus
      // usage for this call.
      finalMsg = await stream.finalMessage();
      sessionUsage = accumulateUsage(sessionUsage, finalMsg.usage);
    } catch (e) {
      if (!event.sender.isDestroyed()) {
        event.sender.send('claude:error', (e as Error).message);
      }
      return;
    }

    const toolUseBlocks = extractToolUses(finalMsg.content);

    if (finalMsg.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
      // Done — no tool calls, conversation is complete.
      break;
    }

    // Echo the assistant turn back verbatim (thinking blocks included, unchanged) so multi-turn
    // continuity holds.
    loopMessages.push({
      role: 'assistant',
      content: finalMsg.content as unknown as Anthropic.ContentBlockParam[],
    });

    // Process tool calls and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tb of toolUseBlocks) {
      if (abortRef.aborted) break;

      let resultContent: string;

      if (tb.name === 'write_file') {
        const filePath = String(tb.input.path ?? '');
        const content = String(tb.input.content ?? '');

        if (autonomousWrites || !win) {
          // Write directly without asking
          try {
            const abs = path.join(effectivePath, filePath);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content, 'utf-8');
            resultContent = `Written successfully: ${filePath}`;
            if (!event.sender.isDestroyed()) {
              event.sender.send('claude:file-written', filePath);
            }
          } catch (e) {
            resultContent = `Error writing file: ${(e as Error).message}`;
          }
        } else {
          // Ask renderer to show preview
          const decision = await askRendererForWrite(win, tb.id, filePath, content);
          if (decision.accepted) {
            try {
              const abs = path.join(effectivePath, filePath);
              fs.mkdirSync(path.dirname(abs), { recursive: true });
              fs.writeFileSync(abs, content, 'utf-8');
              resultContent = `Written successfully: ${filePath}`;
              if (!event.sender.isDestroyed()) {
                event.sender.send('claude:file-written', filePath);
              }
            } catch (e) {
              resultContent = `Error writing file: ${(e as Error).message}`;
            }
          } else {
            resultContent = `User rejected the change${decision.feedback ? `: ${decision.feedback}` : '. Please revise.'}`;
          }
        }
      } else {
        resultContent = await execTool(tb.name, tb.input, effectivePath);
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tb.id,
        content: resultContent,
      });

      // Show tool activity in the chat as a subtle delta
      if (!event.sender.isDestroyed()) {
        const label =
          tb.name === 'read_file' ? `\n\`read: ${String(tb.input.path ?? '')}\`\n`
          : tb.name === 'list_files' ? `\n\`list_files${tb.input.dir ? ` ${String(tb.input.dir)}` : ''}\`\n`
          : tb.name === 'run_shell' ? `\n\`$ ${String(tb.input.command ?? '')}\`\n`
          : '';
        if (label) event.sender.send('claude:tool-activity', label);
      }
    }

    // Add tool results as a user turn and continue the loop
    loopMessages.push({ role: 'user', content: toolResults });
  }

  // Emit cumulative usage once, at the end of the whole turn (not per tool round-trip), so
  // streaming stays active across tool calls and the HUD sees true session totals.
  if (!event.sender.isDestroyed()) {
    event.sender.send('claude:done', {
      inputTokens: sessionUsage.inputTokens,
      outputTokens: sessionUsage.outputTokens,
      cacheReadTokens: sessionUsage.cacheReadTokens,
      cacheCreationTokens: sessionUsage.cacheCreationTokens,
      thinkingTokens: sessionUsage.thinkingTokens,
    });
  }
}
