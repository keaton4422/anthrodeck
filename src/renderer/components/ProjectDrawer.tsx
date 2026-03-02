import React, { useEffect, useState } from 'react';
import { useGit } from '../hooks/useGit';
import VoiceButton from './VoiceButton';
import { useVoice } from '../hooks/useVoice';

interface Props {
  open: boolean;
  onClose: () => void;
  projectPath: string | null;
  files: string[];
  onOpenFolder: () => void;
  onRefreshFiles: () => void;
  autonomousWrites: boolean;
  onToggleAutonomous: () => void;
  onFileClick: (file: string) => void;
}

export default function ProjectDrawer({
  open,
  onClose,
  projectPath,
  files,
  onOpenFolder,
  onRefreshFiles,
  autonomousWrites,
  onToggleAutonomous,
  onFileClick,
}: Props) {
  const git = useGit(projectPath);
  const [activeTab, setActiveTab] = useState<'files' | 'git'>('files');

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

          {/* Autonomous writes toggle */}
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
                Autonomous writes
              </span>
            </div>
          )}
        </div>

        {/* Tabs */}
        {projectPath && (
          <>
            <div style={{ display: 'flex', borderBottom: '1px solid #1E1E1E' }}>
              {(['files', 'git'] as const).map((tab) => (
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
                  {tab}
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
                  <div style={{ color: '#444', fontSize: 13, padding: '12px 16px' }}>No files found</div>
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
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
