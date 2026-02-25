import React, { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  code: string;
  language: string;
}

const RUNNABLE = new Set(['python', 'python3', 'javascript', 'js', 'bash', 'sh', 'ruby', 'rb']);

export function CodeBlock({ code, language }: Props) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<{ stdout: string; stderr: string; error: string | null } | null>(null);

  // Apply syntax highlighting
  useEffect(() => {
    if (!preRef.current) return;
    import('highlight.js').then((hljs) => {
      const el = preRef.current;
      if (!el) return;
      const lang = hljs.default.getLanguage(language) ? language : 'plaintext';
      try {
        el.innerHTML = hljs.default.highlight(code, { language: lang }).value;
      } catch {
        el.textContent = code;
      }
    });
  }, [code, language]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setOutput(null);
    try {
      const result = await window.electronAPI.runShell(code, language);
      setOutput(result);
    } catch (e) {
      setOutput({ stdout: '', stderr: '', error: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }, [code, language]);

  const canRun = RUNNABLE.has(language.toLowerCase());
  const langLabel = language || 'text';

  return (
    <div
      style={{
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid #2A2A2A',
        marginTop: 8,
        marginBottom: 4,
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: '#1A1A1A',
          borderBottom: '1px solid #2A2A2A',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ color: '#CC785C', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em' }}>
          {langLabel.toUpperCase()}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleCopy}
            style={{
              background: 'none',
              border: '1px solid #3A3A3A',
              borderRadius: 4,
              color: copied ? '#52A77C' : '#9A9A9A',
              fontSize: 11,
              padding: '2px 8px',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          {canRun && (
            <button
              onClick={handleRun}
              disabled={running}
              style={{
                background: running ? 'rgba(204,120,92,0.1)' : 'rgba(204,120,92,0.2)',
                border: '1px solid rgba(204,120,92,0.4)',
                borderRadius: 4,
                color: '#CC785C',
                fontSize: 11,
                padding: '2px 10px',
                cursor: running ? 'wait' : 'pointer',
                fontWeight: 600,
                transition: 'all 0.15s',
              }}
            >
              {running ? '⟳ Running…' : '▶ Run'}
            </button>
          )}
        </div>
      </div>

      {/* Code */}
      <div style={{ background: '#0D1117', overflowX: 'auto' }}>
        <pre
          ref={preRef}
          style={{
            padding: '14px 16px',
            margin: 0,
            color: '#e6edf3',
            lineHeight: 1.6,
            whiteSpace: 'pre',
            fontFamily: 'inherit',
            fontSize: 'inherit',
          }}
        >
          {code}
        </pre>
      </div>

      {/* Output panel */}
      {output && (
        <div
          style={{
            background: '#111111',
            borderTop: '1px solid #2A2A2A',
            padding: '10px 14px',
          }}
        >
          <div style={{ fontSize: 11, color: '#9A9A9A', marginBottom: 6, letterSpacing: '0.05em' }}>
            OUTPUT
          </div>
          {output.error && (
            <pre style={{ color: '#E05252', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
              {output.error}
            </pre>
          )}
          {output.stdout && (
            <pre style={{ color: '#ECECEC', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
              {output.stdout}
            </pre>
          )}
          {output.stderr && (
            <pre style={{ color: '#E8926E', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
              {output.stderr}
            </pre>
          )}
          {!output.stdout && !output.stderr && !output.error && (
            <span style={{ color: '#52A77C', fontSize: 12 }}>✓ Done (no output)</span>
          )}
        </div>
      )}
    </div>
  );
}
