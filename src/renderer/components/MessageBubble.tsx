import React, { useMemo } from 'react';
import { ChatMessage, ContentPart } from '../types';
import { CodeBlock } from './CodeBlock';

interface Props {
  message: ChatMessage;
}

/** Split markdown text into text and fenced-code segments */
function parseContent(raw: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const pattern = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const textBefore = raw.slice(lastIdx, match.index).trim();
    if (textBefore) parts.push({ type: 'text', text: textBefore });
    parts.push({ type: 'code', language: match[1] || 'text', code: match[2] });
    lastIdx = match.index + match[0].length;
  }

  const remaining = raw.slice(lastIdx).trim();
  if (remaining) parts.push({ type: 'text', text: remaining });

  return parts;
}

/** Minimal inline markdown: **bold**, `code`, newlines */
function renderText(text: string) {
  const lines = text.split('\n');
  return lines.map((line, li) => {
    const parts: React.ReactNode[] = [];
    const inlinePattern = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
    let lastI = 0;
    let m: RegExpExecArray | null;

    while ((m = inlinePattern.exec(line)) !== null) {
      if (m.index > lastI) parts.push(line.slice(lastI, m.index));
      if (m[2]) {
        parts.push(<strong key={m.index}>{m[2]}</strong>);
      } else if (m[3]) {
        parts.push(
          <code
            key={m.index}
            style={{
              background: '#242424',
              border: '1px solid #3A3A3A',
              borderRadius: 3,
              padding: '0 5px',
              fontFamily: 'JetBrains Mono, Consolas, monospace',
              fontSize: '0.9em',
              color: '#E8926E',
            }}
          >
            {m[3]}
          </code>
        );
      }
      lastI = m.index + m[0].length;
    }
    if (lastI < line.length) parts.push(line.slice(lastI));

    return (
      <React.Fragment key={li}>
        {parts}
        {li < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

const CONFIDENCE_STYLE: Record<'high' | 'med' | 'low', { label: string; color: string }> = {
  high: { label: 'HIGH', color: '#52A77C' },
  med: { label: 'MED', color: '#D9A441' },
  low: { label: 'LOW', color: '#E05252' },
};

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const parts = useMemo(() => parseContent(message.content), [message.content]);
  const conf = message.confidence ? CONFIDENCE_STYLE[message.confidence] : null;
  const lowConfidence = message.confidence === 'low';

  return (
    <div
      className="msg-enter"
      style={{
        padding: '14px 24px',
        borderBottom: '1px solid #1E1E1E',
        borderLeft: lowConfidence ? '3px solid rgba(224,82,82,0.6)' : '3px solid transparent',
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
      }}
    >
      {/* Avatar / Role indicator */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 15,
          flexShrink: 0,
          marginTop: 2,
          background: isUser ? 'rgba(204,120,92,0.15)' : 'rgba(82,167,124,0.12)',
          border: `1px solid ${isUser ? 'rgba(204,120,92,0.3)' : 'rgba(82,167,124,0.25)'}`,
          color: isUser ? '#CC785C' : '#52A77C',
          fontWeight: 700,
          letterSpacing: '0.03em',
        }}
      >
        {isUser ? 'YOU' : '◆'}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: '#6A6A6A',
            marginBottom: 6,
            letterSpacing: '0.05em',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {isUser ? 'YOU' : 'CLAUDE'}
          {conf && (
            <span
              title="Claude's self-assessed confidence"
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: conf.color,
                border: `1px solid ${conf.color}`,
                borderRadius: 4,
                padding: '0 5px',
                lineHeight: '15px',
              }}
            >
              {conf.label}
            </span>
          )}
        </div>

        {parts.map((part, i) => {
          if (part.type === 'code') {
            return <CodeBlock key={i} code={part.code} language={part.language} />;
          }
          return (
            <p
              key={i}
              style={{
                color: isUser ? '#D0D0D0' : '#ECECEC',
                fontSize: 15,
                lineHeight: 1.65,
                marginBottom: parts.length > 1 && i < parts.length - 1 ? 10 : 0,
              }}
            >
              {renderText(part.text)}
            </p>
          );
        })}

        {/* Streaming cursor */}
        {message.isStreaming && message.content === '' && (
          <span className="cursor-blink" />
        )}
      </div>
    </div>
  );
}
