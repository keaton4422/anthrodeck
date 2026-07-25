import React from 'react';
import { PendingQuestion } from '../types';

interface Props {
  question: PendingQuestion;
  onSelect: (value: string) => void;
}

// Face-button colors matching the Steam Deck / Xbox layout: A green, B red, X blue, Y yellow.
const FACE = [
  { key: 'A', color: '#52A77C' },
  { key: 'B', color: '#E05252' },
  { key: 'X', color: '#6A8CC7' },
  { key: 'Y', color: '#D9A441' },
];

export default function AskUserModal({ question, onSelect }: Props) {
  const options = question.options.slice(0, 4);

  return (
    <div
      className="overlay-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        className="panel-in"
        style={{
          background: '#1A1A1A',
          border: '1px solid #CC785C',
          borderRadius: 14,
          padding: 24,
          width: '100%',
          maxWidth: 520,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>❓</span>
          <span style={{ color: '#CC785C', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em' }}>
            CLAUDE IS ASKING
          </span>
        </div>

        <p style={{ color: '#ECECEC', fontSize: 17, lineHeight: 1.5, margin: 0 }}>
          {question.question}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {options.map((opt, i) => {
            const face = FACE[i];
            return (
              <button
                key={`${opt.value}-${i}`}
                onClick={() => onSelect(opt.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid #3A3A3A',
                  background: '#242424',
                  color: '#ECECEC',
                  fontSize: 15,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget).style.borderColor = face.color; }}
                onMouseLeave={(e) => { (e.currentTarget).style.borderColor = '#3A3A3A'; }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#fff',
                    background: face.color,
                  }}
                >
                  {face.key}
                </span>
                <span style={{ flex: 1 }}>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <p style={{ color: '#6A6A6A', fontSize: 12, margin: 0, textAlign: 'center' }}>
          Tap an option or press the matching face button
        </p>
      </div>
    </div>
  );
}
