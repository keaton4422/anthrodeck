import React, { RefObject } from 'react';
import { ChatMessage, PendingWrite } from '../types';
import { MessageBubble } from './MessageBubble';
import WritePreview from './WritePreview';

interface Props {
  messages: ChatMessage[];
  error: string | null;
  scrollRef: RefObject<HTMLDivElement>;
  isStreaming: boolean;
  pendingWrite?: PendingWrite | null;
  onWriteAccept?: () => void;
  onWriteReject?: (feedback?: string) => void;
  writeDiffRef?: RefObject<HTMLPreElement>;
  voiceRejecting?: boolean;
  onRewind?: (id: string) => void;
}

function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        textAlign: 'center',
        gap: 20,
      }}
    >
      <div style={{ fontSize: 56, lineHeight: 1, opacity: 0.3 }}>◆</div>
      <div>
        <p style={{ fontSize: 22, fontWeight: 600, color: '#ECECEC', marginBottom: 10 }}>
          What can I help you build?
        </p>
        <p style={{ fontSize: 15, color: '#6A6A6A', lineHeight: 1.6, maxWidth: 480 }}>
          Hold <kbd style={kbdStyle}>L2</kbd> to speak, or type below.
          <br />
          Try <em style={{ color: '#CC785C' }}>"write a Python script that..."</em>
        </p>
      </div>

      {/* Quick prompts */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 10 }}>
        {QUICK_PROMPTS.map((p) => (
          <QuickPrompt key={p} text={p} />
        ))}
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  background: '#242424',
  border: '1px solid #3A3A3A',
  borderRadius: 4,
  padding: '1px 7px',
  fontSize: 13,
  fontFamily: 'monospace',
  color: '#CC785C',
};

const QUICK_PROMPTS = [
  'Write a Python hello world',
  'Explain how WiFi works',
  'Create a bash script to...',
  'Help me fix this code',
];

function QuickPrompt({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '7px 14px',
        borderRadius: 6,
        border: '1px solid #2A2A2A',
        background: '#1A1A1A',
        color: '#9A9A9A',
        fontSize: 13,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {text}
    </div>
  );
}

export function ChatView({ messages, error, scrollRef, isStreaming, pendingWrite, onWriteAccept, onWriteReject, writeDiffRef, voiceRejecting, onRewind }: Props) {
  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: '#0F0F0F',
      }}
    >
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onRewind={onRewind} />
          ))}
        </>
      )}

      {/* Write preview — shows at the bottom of chat when Claude wants to write a file */}
      {pendingWrite && onWriteAccept && onWriteReject && (
        <div style={{ padding: '0 16px' }}>
          <WritePreview
            write={pendingWrite}
            onAccept={onWriteAccept}
            onReject={onWriteReject}
            contentRef={writeDiffRef}
            voiceRejecting={voiceRejecting}
          />
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          style={{
            margin: '12px 24px',
            padding: '10px 16px',
            borderRadius: 8,
            background: 'rgba(224,82,82,0.1)',
            border: '1px solid rgba(224,82,82,0.35)',
            color: '#E05252',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>⚠</span>
          <span>{error}</span>
        </div>
      )}

      {/* Bottom padding */}
      <div style={{ height: 12 }} />
    </div>
  );
}
