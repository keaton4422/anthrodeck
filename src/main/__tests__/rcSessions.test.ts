import { describe, it, expect } from 'vitest';
import { parseRcSessions, RcChats, unwrap, type RcEntry } from '../rcSessions';

const LISTING = `Peer sessions (6):
  LED Window camera loader [609e05]  ·  interactive  ·  idle  ·  Claude Desktop session  ·  started 4d ago
  anthrodeck-hub [eab51b]  ·  Remote Control  ·  idle
  Invoice vendor name mismatch [7880c9]  ·  Remote Control  ·  idle
  Maintenance workbook linking [558840]  ·  Remote Control  ·  running
  Spider-Man VR mod setup [8b0b35]  ·  Remote Control  ·  offline
  LED-window project review [5a84c6]  ·  cloud  ·  idle`;

describe('Remote Control sessions on any computer', () => {
  it('lists the Remote Control ones, working first, without AnthroDeck\'s own link or cloud sessions', () => {
    expect(parseRcSessions(LISTING)).toEqual([
      { name: 'Maintenance workbook linking', ref: '558840', status: 'busy' },
      { name: 'Invoice vendor name mismatch', ref: '7880c9', status: 'idle' },
      { name: 'Spider-Man VR mod setup', ref: '8b0b35', status: 'offline' },
    ]);
  });

  it('keeps each conversation, and matches answers to the session they came from', () => {
    const changes: [string, RcEntry[]][] = [];
    const chats = new RcChats((ref, e) => changes.push([ref, e]), () => 1);
    const known = parseRcSessions(LISTING);
    chats.sent('7880c9', 'Which vendor?');
    chats.received('bridge:session_abc', '<cross-session-message from="bridge:session_abc">Acme Ltd.</cross-session-message>', known);
    chats.sent('558840', 'Status?');
    // The same address again: still the invoice session, though the pilot messaged another since.
    chats.received('bridge:session_abc', 'Fixed it.', known);
    expect(chats.get('7880c9').map((e) => [e.role, e.text])).toEqual([['user', 'Which vendor?'], ['assistant', 'Acme Ltd.'], ['assistant', 'Fixed it.']]);
    // An answer naming its session's short id goes there whatever the address.
    chats.received('bridge:session_new', 'Done [558840]', known);
    expect(chats.get('558840').map((e) => e.text)).toEqual(['Status?', 'Done [558840]']);
    const id = chats.sent('558840', 'Again?');
    chats.undelivered(id, 'offline');
    expect(chats.get('558840').at(-1)).toMatchObject({ role: 'peer', text: 'Not delivered: offline' });
    expect(changes.length).toBe(7);
  });

  it('takes the envelope off a message', () => {
    expect(unwrap('<cross-session-message from="x" name="y">\nhello\n</cross-session-message>')).toBe('hello');
  });
});
