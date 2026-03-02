import { IpcMainEvent, BrowserWindow } from 'electron';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// ─── Tool definitions given to Claude ─────────────────────────────────────────
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any,
  projectPath: string,
): Promise<string> {
  return new Promise((resolve) => {
    if (name === 'read_file') {
      try {
        const abs = path.join(projectPath, input.path);
        const content = fs.readFileSync(abs, 'utf-8');
        resolve(content);
      } catch (e) {
        resolve(`Error reading file: ${(e as Error).message}`);
      }
    } else if (name === 'list_files') {
      try {
        const base = input.dir ? path.join(projectPath, input.dir) : projectPath;
        const files = listFilesRecursive(base, projectPath);
        resolve(files.join('\n') || '(empty directory)');
      } catch (e) {
        resolve(`Error listing files: ${(e as Error).message}`);
      }
    } else if (name === 'run_shell') {
      exec(input.command, { cwd: projectPath, timeout: 60000 }, (err, stdout, stderr) => {
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

// ─── Main agentic loop ─────────────────────────────────────────────────────────
export async function runAgentLoop(
  event: IpcMainEvent,
  messages: Anthropic.MessageParam[],
  apiKey: string,
  projectPath: string | null,
  autonomousWrites: boolean,
  win: BrowserWindow | null,
  abortRef: { aborted: boolean },
) {
  const anthropic = new Anthropic({ apiKey });
  const effectivePath = projectPath ?? process.env.HOME ?? '/tmp';

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

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (abortRef.aborted) {
      event.sender.send('claude:error', 'Aborted');
      return;
    }

    let responseText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUseBlocks: any[] = [];
    let stopReason = 'end_turn';

    try {
      const stream = await anthropic.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 8192,
        system: systemPrompt,
        tools: projectPath ? TOOLS : [],
        messages: loopMessages,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let currentToolBlock: any = null;
      let currentToolInput = '';

      for await (const event_ of stream) {
        if (abortRef.aborted) break;

        if (event_.type === 'content_block_start') {
          if (event_.content_block.type === 'tool_use') {
            currentToolBlock = { id: event_.content_block.id, name: event_.content_block.name };
            currentToolInput = '';
          }
        } else if (event_.type === 'content_block_delta') {
          if (event_.delta.type === 'text_delta') {
            responseText += event_.delta.text;
            if (!event.sender.isDestroyed()) {
              event.sender.send('claude:delta', event_.delta.text);
            }
          } else if (event_.delta.type === 'input_json_delta' && currentToolBlock) {
            currentToolInput += event_.delta.partial_json;
          }
        } else if (event_.type === 'content_block_stop') {
          if (currentToolBlock) {
            try {
              currentToolBlock.input = JSON.parse(currentToolInput || '{}');
            } catch {
              currentToolBlock.input = {};
            }
            toolUseBlocks.push(currentToolBlock);
            currentToolBlock = null;
            currentToolInput = '';
          }
        } else if (event_.type === 'message_delta') {
          stopReason = event_.delta.stop_reason ?? 'end_turn';
        } else if (event_.type === 'message_stop') {
          const finalMsg = await stream.finalMessage();
          if (!event.sender.isDestroyed()) {
            event.sender.send('claude:done', {
              inputTokens: finalMsg.usage.input_tokens,
              outputTokens: finalMsg.usage.output_tokens,
            });
          }
        }
      }
    } catch (e) {
      if (!event.sender.isDestroyed()) {
        event.sender.send('claude:error', (e as Error).message);
      }
      return;
    }

    // Build the assistant message content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assistantContent: any[] = [];
    if (responseText) assistantContent.push({ type: 'text', text: responseText });
    for (const tb of toolUseBlocks) {
      assistantContent.push({ type: 'tool_use', id: tb.id, name: tb.name, input: tb.input });
    }

    if (stopReason !== 'tool_use' || toolUseBlocks.length === 0) {
      // Done — no tool calls, conversation is complete
      break;
    }

    // Add assistant's response to loop messages
    loopMessages.push({ role: 'assistant', content: assistantContent });

    // Process tool calls and collect results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = [];

    for (const tb of toolUseBlocks) {
      if (abortRef.aborted) break;

      let resultContent: string;

      if (tb.name === 'write_file') {
        const filePath: string = tb.input.path ?? '';
        const content: string = tb.input.content ?? '';

        if (autonomousWrites || !win) {
          // Write directly without asking
          try {
            const abs = path.join(effectivePath, filePath);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content, 'utf-8');
            resultContent = `Written successfully: ${filePath}`;
            // Notify renderer so it can show a toast
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
          tb.name === 'read_file' ? `\n\`read: ${tb.input.path}\`\n`
          : tb.name === 'list_files' ? `\n\`list_files${tb.input.dir ? ` ${tb.input.dir}` : ''}\`\n`
          : tb.name === 'run_shell' ? `\n\`$ ${tb.input.command}\`\n`
          : '';
        if (label) event.sender.send('claude:tool-activity', label);
      }
    }

    // Add tool results as a user turn and continue the loop
    loopMessages.push({ role: 'user', content: toolResults });
  }
}
