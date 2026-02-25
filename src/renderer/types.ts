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

// Extend Window with our Electron bridge
declare global {
  interface Window {
    electronAPI: {
      storeGet: (key: string) => Promise<unknown>;
      storeSet: (key: string, value: unknown) => Promise<void>;
      runShell: (code: string, language: string) => Promise<ShellResult>;
      claudeSend: (data: { messages: Array<{ role: string; content: string }>; apiKey: string }) => void;
      claudeAbort: () => void;
      onClaudeDelta: (cb: (delta: string) => void) => () => void;
      onClaudeDone: (cb: (usage: TokenUsage) => void) => () => void;
      onClaudeError: (cb: (error: string) => void) => () => void;
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
  }

  /** Update states for useUpdater hook */
  type UpdateState =
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'up-to-date'
    | 'error';
  interface Window {
    // Web Speech API (may not be defined in TS lib for Electron context)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SpeechRecognition: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition: any;
  }
}
