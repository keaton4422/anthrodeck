import React, { useEffect, useState } from 'react';
import { useGit } from '../hooks/useGit';
import VoiceButton from './VoiceButton';
import { useVoice } from '../hooks/useVoice';
import { Sector, type Commit } from '../types';
import { timeAgo } from '../lib/timeAgo';

// Pilot: the pilot's rank and achievements. Overview: what's going on, and what the app does.
const TAB_LABELS = { files: 'files', git: 'git', pilot: 'pilot', overview: 'overview' } as const;
import { PilotTab } from './PilotTab';
import { OverviewTab } from './OverviewTab';
import type { SeasonView } from '../hooks/useSeason';
import type { ContextGauge } from '../hooks/useClaude';


interface Props {
  open: boolean;
  onClose: () => void;
  projectPath: string | null;
  projectRemote?: string | null;   // the remote computer's name when the project is on it
  otherComputer: string | null;    // the remote computer set up in Settings, if any
  session: { title: string; said: string | null; working: boolean } | null;
  files: string[];
  onOpenFolder: () => void;
  onRefreshFiles: () => void;
  autonomousWrites: boolean;
  onToggleAutonomous: () => void;
  onFileClick: (file: string) => void;
  sectors: Sector[];
  context: ContextGauge | null;
  season: SeasonView;
  onPitStop: () => void;
  isStreaming: boolean;
  onShare: () => void;
}

export default function ProjectDrawer({
  open,
  onClose,
  projectPath,
  projectRemote,
  otherComputer,
  session,
  files,
  onOpenFolder,
  onRefreshFiles,
  autonomousWrites,
  onToggleAutonomous,
  onFileClick,
  sectors,
  context,
  season,
  onPitStop,
  isStreaming,
  onShare,
}: Props) {
  const git = useGit(projectPath);
  const [activeTab, setActiveTab] = useState<keyof typeof TAB_LABELS>('files');

  // Refresh git status when drawer opens
  useEffect(() => {
    if (open && projectPath) {
      git.refresh();
      onRefreshFiles();
    }
  }, [open, projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVoiceResult = (text: string) => {
    git.setCommitMsg((prev) => (prev ? `${prev} ${text}` : text));
  };

  const { isListening, transcript, isSupported, startListening, stopListening } =
    useVoice(handleVoiceResult);

  const folderName = projectPath ? projectPath.split(/[\\/]/).pop() : null;

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(0,0,0,0.5)',
          }}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 320,
        zIndex: 50,
        background: '#141414',
        borderRight: '1px solid #2A2A2A',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.22s ease',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          borderBottom: '1px solid #2A2A2A',
        }}>
          <span style={{ color: '#CC785C', fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>
            PROJECT
          </span>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: '#555',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Project folder selector */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1E1E1E' }}>
          <button
            onClick={onOpenFolder}
            style={{
              width: '100%',
              padding: '10px 14px',
              background: '#1A1A1A',
              border: '1px solid #333',
              borderRadius: 8,
              color: '#ddd',
              fontSize: 13,
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>📁</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {folderName ?? 'Open Folder…'}
            </span>
            {projectPath && <span style={{ color: '#555', fontSize: 11 }}>change</span>}
          </button>

          {/* Auto-accept edits toggle: edits land without a card (Claude Code's acceptEdits). Commands still ask. */}
          {projectPath && (
            <div
              onClick={onToggleAutonomous}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 10,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <div style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                background: autonomousWrites ? '#CC785C' : '#2A2A2A',
                border: '1px solid #3A3A3A',
                position: 'relative',
                transition: 'background 0.2s',
              }}>
                <div style={{
                  position: 'absolute',
                  top: 2,
                  left: autonomousWrites ? 17 : 2,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.2s',
                }} />
              </div>
              <span style={{ fontSize: 12, color: autonomousWrites ? '#CC785C' : '#666' }}>
                Auto-accept edits · edits land on their own
              </span>
            </div>
          )}

          {/* Share preview over LAN */}
          {projectPath && (
            <button
              onClick={onShare}
              style={{
                width: '100%', marginTop: 10, padding: '9px 14px',
                background: '#1A1A1A', border: '1px solid #CC785C', borderRadius: 8,
                color: '#CC785C', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
              }}
            >
              <span>📡</span> Share preview
            </button>
          )}
        </div>

        {/* Tabs */}
        {projectPath && (
          <>
            <div style={{ display: 'flex', borderBottom: '1px solid #1E1E1E' }}>
              {(Object.keys(TAB_LABELS) as (keyof typeof TAB_LABELS)[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === tab ? '2px solid #CC785C' : '2px solid transparent',
                    color: activeTab === tab ? '#CC785C' : '#666',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: 1,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                  }}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>

            {/* Files tab */}
            {activeTab === 'files' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 12px 6px' }}>
                  <button
                    onClick={onRefreshFiles}
                    style={{ background: 'none', border: 'none', color: '#555', fontSize: 11, cursor: 'pointer' }}
                  >
                    ↻ refresh
                  </button>
                </div>
                {files.length === 0 ? (
                  <div style={{ color: '#444', fontSize: 13, padding: '12px 16px', lineHeight: 1.5 }}>
                    {projectRemote
                      ? `This project is on ${projectRemote}. Its files aren't listed here yet; ask Claude about them instead.`
                      : 'No files found'}
                  </div>
                ) : (
                  files.map((f) => (
                    <div
                      key={f}
                      onClick={() => !f.endsWith('/') && onFileClick(f)}
                      style={{
                        padding: '5px 16px',
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: f.endsWith('/') ? '#555' : '#bbb',
                        cursor: f.endsWith('/') ? 'default' : 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      onMouseEnter={(e) => {
                        if (!f.endsWith('/')) (e.currentTarget as HTMLDivElement).style.background = '#1F1F1F';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                      }}
                    >
                      {f.endsWith('/') ? `📂 ${f}` : `  ${f}`}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Git tab */}
            {activeTab === 'git' && (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Status */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #1E1E1E' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ color: '#666', fontSize: 11, letterSpacing: 1, fontWeight: 600 }}>STATUS</span>
                    <button
                      onClick={git.refresh}
                      style={{ background: 'none', border: 'none', color: '#555', fontSize: 11, cursor: 'pointer', marginLeft: 'auto' }}
                    >
                      ↻
                    </button>
                  </div>
                  <pre style={{
                    margin: 0,
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: '#888',
                    background: '#0D0D0D',
                    borderRadius: 6,
                    padding: '8px 10px',
                    minHeight: 40,
                    maxHeight: 120,
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {git.statusText || 'Nothing to commit'}
                  </pre>
                </div>

                {/* Commit */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #1E1E1E' }}>
                  <div style={{ color: '#666', fontSize: 11, letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>
                    COMMIT
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <textarea
                      value={isListening ? transcript || git.commitMsg : git.commitMsg}
                      onChange={(e) => git.setCommitMsg(e.target.value)}
                      placeholder="Commit message… (hold mic to speak)"
                      rows={2}
                      style={{
                        flex: 1,
                        background: '#1A1A1A',
                        border: '1px solid #2A2A2A',
                        borderRadius: 6,
                        color: '#ddd',
                        fontSize: 13,
                        padding: '7px 9px',
                        resize: 'none',
                        fontFamily: 'inherit',
                      }}
                    />
                    {isSupported && (
                      <VoiceButton
                        isListening={isListening}
                        isSupported={isSupported}
                        transcript=""
                        onStart={startListening}
                        onStop={stopListening}
                        compact
                      />
                    )}
                  </div>
                  <button
                    onClick={git.commit}
                    disabled={git.isWorking || !git.commitMsg.trim()}
                    style={{
                      width: '100%',
                      marginTop: 8,
                      padding: '9px 0',
                      background: git.commitMsg.trim() ? '#CC785C' : '#1E1E1E',
                      color: git.commitMsg.trim() ? '#fff' : '#444',
                      border: 'none',
                      borderRadius: 7,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: git.commitMsg.trim() ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {git.isWorking ? 'Working…' : 'Add All & Commit'}
                  </button>
                </div>

                {/* Push */}
                <div style={{ padding: '12px 16px' }}>
                  <button
                    onClick={git.push}
                    disabled={git.isWorking}
                    style={{
                      width: '100%',
                      padding: '10px 0',
                      background: '#1A1A1A',
                      color: '#CC785C',
                      border: '1px solid #CC785C',
                      borderRadius: 7,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {git.isWorking ? 'Pushing…' : '↑ Push'}
                  </button>

                  {/* Result */}
                  {git.lastResult && (
                    <pre style={{
                      margin: '8px 0 0',
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: git.lastResult.toLowerCase().includes('error') ? '#E07050' : '#6A9955',
                      background: '#0D0D0D',
                      borderRadius: 6,
                      padding: '6px 8px',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {git.lastResult}
                    </pre>
                  )}
                </div>
                {/* History */}
                <div style={{ padding: '12px 16px', borderTop: '1px solid #1E1E1E' }}>
                  <div style={{ color: '#666', fontSize: 11, letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>HISTORY</div>
                  <GitHistory history={git.history} />
                </div>
              </div>
            )}

            {activeTab === 'pilot' && <PilotTab season={season} />}

            {activeTab === 'overview' && (
              <OverviewTab
                project={folderName ?? null}
                remoteLabel={projectRemote ?? null}
                otherLabel={otherComputer}
                session={session ?? (isStreaming ? { title: 'This session', said: null, working: true } : null)}
                sectors={sectors}
                context={context}
                onCompact={onPitStop}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── Git history ─────────────────────────────────────────────────────────────
function GitHistory({ history }: { history: { commits: Commit[]; error: string | null } | null }) {
  if (!history) return <div style={{ color: '#555', fontSize: 12 }}>Reading the history…</div>;
  if (history.error) return <div style={{ color: '#D9A441', fontSize: 12, lineHeight: 1.5 }}>{history.error}</div>;
  if (!history.commits.length) return <div style={{ color: '#555', fontSize: 12 }}>No commits yet.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {history.commits.map((c, i) => (
        <div key={c.hash} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: i ? '1px solid #1A1A1A' : 'none' }}>
          {/* The line of history: a dot per commit. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: i ? '#3A3A3A' : '#CC785C', flexShrink: 0 }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, color: '#DDD', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.subject}>
              {c.subject}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 11, color: '#6A6A6A' }}>
              <code style={{ color: '#8A8A8A' }}>{c.hash}</code>
              <span>{c.author} · {timeAgo(c.at)}</span>
              {c.refs.map((r) => (
                <span key={r} style={{
                  padding: '0 6px', borderRadius: 8, border: '1px solid #3A3A3A',
                  color: r.startsWith('v') && /\d/.test(r) ? '#D9A441' : '#52A77C',
                }}>{r}</span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  background: '#1A1A1A', border: '1px solid #333', borderRadius: 6,
  color: '#9A9A9A', fontSize: 11, cursor: 'pointer', padding: '3px 8px',
};
