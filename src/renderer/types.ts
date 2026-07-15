export type Confidence = 'high' | 'med' | 'low';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  confidence?: Confidence;
}

export interface PendingQuestion {
  id: string;
  question: string;
  options: { label: string; value: string }[];
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

export interface TurnResult extends TokenUsage {
  confidence: Confidence | null;
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

export type ModelId = 'claude-opus-4-8' | 'claude-sonnet-5' | 'claude-haiku-4-5';
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
      // Git
      gitStatus: () => Promise<GitOpResult>;
      gitAddAndCommit: (message: string) => Promise<GitOpResult>;
      gitPush: () => Promise<GitOpResult>;
      // Shell
      runShell: (code: string, language: string) => Promise<ShellResult>;
      // Claude (agentic)
      claudeSend: (data: {
        messages: Array<{ role: string; content: string }>;
        apiKey: string;
        projectPath: string | null;
        autonomousWrites: boolean;
        model: string;
        extendedThinking: boolean;
        effort: string;
        teachMode: boolean;
        teachTimeout: number;
      }) => void;
      claudeAbort: () => void;
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
      // Updater
      updaterGetVersion: () => Promise<string>;
      updaterCheck: () => Promise<unknown>;
      updaterDownload: () => Promise<void>;
      updaterInstall: () => void;
      onUpdaterAvailable: (cb: (info: { version: string }) => void) => () => void;
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
