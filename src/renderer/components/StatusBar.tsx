import React, { useState } from 'react';
import { DriveMode, TokenUsage } from '../types';
import { DRIVE_MODE_LABELS } from '../../main/engine/config';
import {
  budgetLevel,
  budgetFraction,
  BUDGET_COLORS,
  formatTokens,
} from '../lib/pilot';

interface Props {
  isListening: boolean;
  isTranscribing?: boolean;
  isStreaming: boolean;
  engineReady: boolean;
  projectPath: string | null;
  usage: TokenUsage;
  budget: number;
  // Claude Code's real context fill (0-100), when it has reported one.
  contextPct: number | null;
  costUsd: number;
  mode: DriveMode;
  onCycleMode: () => void;
  career: { level: number; tier: string; progress: number };
  onDrawer: () => void;
  onSettings: () => void;
  onCockpit: () => void;
}

// The fuel gauge. When Claude Code has reported its context fill, that is the gauge (it is what
// actually runs out); otherwise session tokens against the soft budget. Hover for the breakdown.
function TokenHUD({ usage, budget, contextPct, costUsd }: { usage: TokenUsage; budget: number; contextPct: number | null; costUsd: number }) {
  const [hover, setHover] = useState(false);
  const total =
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  const level = contextPct !== null ? budgetLevel(contextPct, 100) : budgetLevel(total, budget);
  const color = BUDGET_COLORS[level];
  const frac = contextPct !== null ? budgetFraction(contextPct, 100) : budgetFraction(total, budget);

  return (
    <div
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ width: 90, height: 6, background: '#2A2A2A', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            width: `${frac * 100}%`,
            height: '100%',
            background: color,
            borderRadius: 3,
            transition: 'width 0.3s ease, background 0.3s ease',
          }}
        />
      </div>
      <span style={{ fontSize: 11, color: '#8A8A8A', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
        {contextPct !== null ? (
          <>ctx {Math.round(contextPct)}%</>
        ) : (
          <>{formatTokens(total)}<span style={{ color: '#555' }}> / {formatTokens(budget)}</span></>
        )}
        {costUsd > 0 && <span style={{ color: '#666' }}> · ${costUsd.toFixed(2)}</span>}
      </span>

      {hover && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 60,
            background: '#1A1A1A',
            border: '1px solid #3A3A3A',
            borderRadius: 8,
            padding: '10px 12px',
            width: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
          }}
        >
          <HudRow label="Input" value={usage.inputTokens} color="#ECECEC" />
          <HudRow label="Output" value={usage.outputTokens} color="#ECECEC" />
          <HudRow label="Cache read (free)" value={usage.cacheReadTokens} color="#52A77C" />
          <HudRow label="Cache write" value={usage.cacheCreationTokens} color="#9A9A9A" />
          <HudRow label="Thinking" value={usage.thinkingTokens} color="#6A8CC7" />
          <div style={{ height: 1, background: '#2A2A2A', margin: '2px 0' }} />
          <HudRow label="Total" value={total} color={color} bold />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ color: '#8A8A8A' }}>Est. cost</span>
            <span style={{ color: '#ECECEC', fontFamily: 'monospace' }}>${costUsd.toFixed(3)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function HudRow({ label, value, color, bold }: { label: string; value: number; color: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
      <span style={{ color: '#8A8A8A' }}>{label}</span>
      <span style={{ color, fontFamily: 'monospace', fontWeight: bold ? 700 : 400 }}>
        {formatTokens(value)}
      </span>
    </div>
  );
}

const MODE_COLORS: Record<DriveMode, string> = { plan: '#6A8CC7', default: '#52A77C', acceptEdits: '#E0A040' };

// Drive-mode pill (R1 paddle cycles it) and the career badge.
function ModePill({ mode, onClick }: { mode: DriveMode; onClick: () => void }) {
  const c = MODE_COLORS[mode];
  return (
    <button onClick={onClick} title="Drive mode (R1)" style={{
      background: 'none', border: `1px solid ${c}`, borderRadius: 12, padding: '3px 10px',
      color: c, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', whiteSpace: 'nowrap',
    }}>
      {DRIVE_MODE_LABELS[mode].toUpperCase()}
    </button>
  );
}

function CareerBadge({ level, tier, progress }: { level: number; tier: string; progress: number }) {
  return (
    <div title={`${tier} · level ${level}`} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 64 }}>
      <span style={{ fontSize: 11, color: '#ECECEC', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {tier} <span style={{ color: '#CC785C' }}>L{level}</span>
      </span>
      <div style={{ height: 3, background: '#2A2A2A', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: '#CC785C', transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

export function StatusBar({
  isListening, isTranscribing, isStreaming, engineReady, projectPath, usage, budget, contextPct, costUsd,
  mode, onCycleMode, career, onDrawer, onSettings, onCockpit,
}: Props) {
  const folderName = projectPath ? projectPath.split(/[\\/]/).pop() : null;

  return (
    <div
      style={{
        height: 52,
        background: '#141414',
        borderBottom: '1px solid #2A2A2A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        flexShrink: 0,
        userSelect: 'none',
        gap: 10,
      }}
    >
      {/* Left: Drawer toggle + Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onDrawer}
          title="Project & Git (Y button)"
          style={{
            background: 'none',
            border: '1px solid #2A2A2A',
            borderRadius: 6,
            padding: '4px 8px',
            color: projectPath ? '#CC785C' : '#555',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget).style.borderColor = '#CC785C'; }}
          onMouseLeave={(e) => { (e.currentTarget).style.borderColor = '#2A2A2A'; }}
        >
          ☰
        </button>

        <span style={{ fontSize: 20, lineHeight: 1 }}>◆</span>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', color: '#ECECEC' }}>
          ANTHRO<span style={{ color: '#CC785C' }}>DECK</span>
        </span>
      </div>

      {/* Center: project name */}
      {folderName && (
        <div style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
          <span style={{
            fontSize: 12,
            color: '#666',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 300,
          }}>
            📁 {folderName}
          </span>
        </div>
      )}

      {/* Right: Status indicators + settings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isListening && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#E05252',
              display: 'inline-block', animation: 'blink 0.8s step-end infinite',
            }} />
            <span style={{ fontSize: 12, color: '#E05252', fontWeight: 600, letterSpacing: '0.08em' }}>
              LISTENING
            </span>
          </div>
        )}
        {isTranscribing && !isListening && (
          <span style={{ fontSize: 12, color: '#6A8CC7', fontWeight: 600, letterSpacing: '0.06em' }}>
            …TRANSCRIBING
          </span>
        )}
        {isStreaming && !isListening && !isTranscribing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="streaming-dot-1" style={{ width: 5, height: 5, borderRadius: '50%', background: '#CC785C', display: 'inline-block' }} />
            <span className="streaming-dot-2" style={{ width: 5, height: 5, borderRadius: '50%', background: '#CC785C', display: 'inline-block' }} />
            <span className="streaming-dot-3" style={{ width: 5, height: 5, borderRadius: '50%', background: '#CC785C', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: '#9A9A9A', marginLeft: 4, letterSpacing: '0.06em' }}>ON TRACK</span>
          </div>
        )}
        {!engineReady && !isListening && !isStreaming && (
          <span style={{ fontSize: 12, color: '#E05252' }}>⚠ Engine not installed</span>
        )}
        <ModePill mode={mode} onClick={onCycleMode} />
        {engineReady && <TokenHUD usage={usage} budget={budget} contextPct={contextPct} costUsd={costUsd} />}
        <CareerBadge {...career} />
        <button
          onClick={onCockpit}
          title="Cockpit game layer"
          style={{
            background: 'none', border: '1px solid #3A3A3A', borderRadius: 6,
            padding: '4px 10px', color: '#9A9A9A', cursor: 'pointer', fontSize: 15,
            transition: 'all 0.15s', lineHeight: 1,
          }}
          onMouseEnter={(e) => { (e.currentTarget).style.color = '#CC785C'; (e.currentTarget).style.borderColor = '#CC785C'; }}
          onMouseLeave={(e) => { (e.currentTarget).style.color = '#9A9A9A'; (e.currentTarget).style.borderColor = '#3A3A3A'; }}
        >
          🎮
        </button>
        <button
          onClick={onSettings}
          style={{
            background: 'none',
            border: '1px solid #3A3A3A',
            borderRadius: 6,
            padding: '4px 10px',
            color: '#9A9A9A',
            cursor: 'pointer',
            fontSize: 16,
            transition: 'all 0.15s',
            lineHeight: 1,
          }}
          title="Settings (B button / Start)"
          onMouseEnter={(e) => {
            (e.currentTarget).style.color = '#CC785C';
            (e.currentTarget).style.borderColor = '#CC785C';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget).style.color = '#9A9A9A';
            (e.currentTarget).style.borderColor = '#3A3A3A';
          }}
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
