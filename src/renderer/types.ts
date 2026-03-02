export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

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
      }) => void;
      claudeAbort: () => void;
      onClaudeDelta: (cb: (delta: string) => void) => () => void;
      onClaudeDone: (cb: (usage: TokenUsage) => void) => () => void;
      onClaudeError: (cb: (error: string) => void) => () => void;
      onClaudeToolActivity: (cb: (label: string) => void) => () => void;
      onWritePreview: (cb: (data: PendingWrite) => void) => () => void;
      sendWriteDecision: (id: string, accepted: boolean, feedback?: string) => void;
      onFileWritten: (cb: (filePath: string) => void) => () => void;
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
