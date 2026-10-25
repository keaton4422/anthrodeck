import type { EngineEvent } from '../main/engine/session';
import type { TurnSummary } from '../main/engine/translate';
import type { Sector, Milestone } from '../main/engine/tools';
import type { DriveMode } from '../main/engine/config';
import type { UpdateAvailable, WhatsNew } from '../main/releaseNotes';

// The engine's event vocabulary is defined once, in the main process, and shared here as types only.
export type { EngineEvent, Sector, Milestone, DriveMode, UpdateAvailable, WhatsNew };

export type Confidence = 'high' | 'med' | 'low';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  confidence?: Confidence;
  // Assistant turns: Claude Code message uuid a rewind to this turn resumes from.
  anchor?: string | null;
}

export interface PendingQuestion {
  id: string;
  // 'question' = Claude asking, 'approval' = a tool wants a yes/no, 'plan' = lights-out decision.
  kind?: 'question' | 'approval' | 'plan';
  question: string;
  // Optional monospace context: the command, file or plan the question is about.
  detail?: string;
  options: { label: string; value: string; description?: string }[];
}

export interface TeachRequest {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  why: string;
  timeout: number;
}

export interface Flashcard {
  id: string;
  text: string;
  timestamp: number;
}

// Token and cost figures are session totals; replace, don't accumulate.
export type TurnResult = TurnSummary;

export interface EngineStatus {
  found: boolean;
  path: string | null;
  source: 'override' | 'installer' | 'path' | 'bundled' | null;
  version: string | null;
  installCommand: string;
  hasApiKey: boolean;
}

export interface EngineSettingsPayload {
  model: string;
  effort: string;
  thinking: boolean;
  teachMode: boolean;
  teachTimeout: number;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
}

export type ModelId = 'sonnet' | 'opus' | 'haiku';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'code'; language: string; code: string };

export interface PendingWrite {
  id: string;
  path: string;
  content: string;
}

export interface GitOpResult {
  stdout: string;
  stderr: string;
}

export interface LocalVoiceStatus {
  available: boolean;
  ready: boolean;
  model: string;
  reason?: string;
}

export interface PairingSession {
  active: boolean;
  url: string | null;
  code: string | null;
  expiresAt: number | null;
  error?: string;
}

export interface PreviewStatus {
  running: boolean;
  url: string | null;
  lanIp: string | null;
  port: number;
  https: boolean;
  mode: 'static' | 'proxy' | 'idle';
  servedDir: string | null;
  devPort: number | null;
  error?: string;
}

// Extend Window with our Electron bridge
declare global {
  interface Window {
    electronAPI: {
      // Store
      storeGet: (key: string) => Promise<unknown>;
      storeSet: (key: string, value: unknown) => Promise<void>;
      // Project
      projectOpenDialog: () => Promise<string | null>;
      projectGet: () => Promise<string | null>;
      projectSet: (p: string) => Promise<void>;
      // File system
      fsList: (dir?: string) => Promise<string[]>;
      fsRead: (relPath: string) => Promise<string>;
      fsWrite: (relPath: string, content: string) => Promise<void>;
      writeUndo: () => Promise<{ ok: boolean; message: string; relPath?: string }>;
      // Git
      gitStatus: () => Promise<GitOpResult>;
      gitAddAndCommit: (message: string) => Promise<GitOpResult>;
      gitPush: () => Promise<GitOpResult>;
      // Shell
      runShell: (code: string, language: string) => Promise<ShellResult>;
      // Claude (agentic)
      claudeSend: (data: { text: string; settings: EngineSettingsPayload }) => void;
      claudeAbort: () => void;
      claudeReset: () => void;
      claudeRewind: (anchor: string | null) => void;
      claudeSetMode: (mode: DriveMode) => Promise<DriveMode>;
      claudeGetMode: () => Promise<DriveMode>;
      onEngineEvent: (cb: (ev: EngineEvent) => void) => () => void;
      onPromptCancel: (cb: (id: string) => void) => () => void;
      engineStatus: () => Promise<EngineStatus>;
      engineInstall: () => Promise<{ ok: boolean; output: string }>;
      onClaudeDelta: (cb: (delta: string) => void) => () => void;
      onClaudeThinkingDelta: (cb: (delta: string) => void) => () => void;
      onClaudeDone: (cb: (result: TurnResult) => void) => () => void;
      onClaudeError: (cb: (error: string) => void) => () => void;
      onClaudeToolActivity: (cb: (label: string) => void) => () => void;
      onWritePreview: (cb: (data: PendingWrite) => void) => () => void;
      sendWriteDecision: (id: string, accepted: boolean, feedback?: string) => void;
      onAskUser: (cb: (data: PendingQuestion) => void) => () => void;
      sendAskUserDecision: (id: string, value: string) => void;
      onTeach: (cb: (data: TeachRequest) => void) => () => void;
      sendTeachDecision: (id: string, action: 'continue' | 'redirect', instruction?: string) => void;
      onFlashcard: (cb: (card: Flashcard) => void) => () => void;
      onFileWritten: (cb: (filePath: string) => void) => () => void;
      // Preview / LAN sharing
      previewStart: (opts: { port?: number; https?: boolean; devPort?: number | null }) => Promise<PreviewStatus>;
      previewStop: () => Promise<PreviewStatus>;
      previewStatus: () => Promise<PreviewStatus>;
      previewDetectDev: () => Promise<number | null>;
      // Local voice (whisper)
      voiceLocalStatus: () => Promise<LocalVoiceStatus>;
      voiceDownloadModel: () => Promise<{ ok: boolean; message: string }>;
      voiceTranscribe: (wav: ArrayBuffer) => Promise<string | null>;
      // Flashcards
      flashcardsGet: () => Promise<Flashcard[]>;
      flashcardGenerate: () => Promise<Flashcard | null>;
      flashcardsClear: () => Promise<void>;
      // API key pairing
      pairStart: () => Promise<PairingSession>;
      pairStop: () => Promise<PairingSession>;
      onPairReceived: (cb: () => void) => () => void;
      // Updater
      updaterGetVersion: () => Promise<string>;
      updaterCheck: () => Promise<unknown>;
      updaterDownload: () => Promise<void>;
      updaterInstall: () => void;
      updaterLastAvailable: () => Promise<UpdateAvailable | null>;
      onUpdaterAvailable: (cb: (info: UpdateAvailable) => void) => () => void;
      onUpdaterUpToDate: (cb: () => void) => () => void;
      onUpdaterProgress: (cb: (info: { percent: number; bytesPerSecond: number }) => void) => () => void;
      onUpdaterReady: (cb: (info: { version: string }) => void) => () => void;
      onUpdaterError: (cb: (error: string) => void) => () => void;
    };
    // Web Speech API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SpeechRecognition: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition: any;
  }

  type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error';
}
