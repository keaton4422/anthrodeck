import Store from 'electron-store';
import type Anthropic from '@anthropic-ai/sdk';

// Session flashcards: every N executed tool calls (or on request) we ask a cheap model for one
// one-sentence "thing worth remembering" about the project and persist it per-project. The prompt
// building + counting logic is pure and unit-tested; only generate() touches the network.

export interface Flashcard {
  id: string;
  text: string;
  timestamp: number;
}

export const CARDS_EVERY = 10;
const CARD_MODEL = 'claude-haiku-4-5';

// Lazy so importing this module (e.g. for the pure helpers in tests) doesn't construct an
// electron-store, which needs the Electron app at runtime.
let _store: Store | null = null;
function store(): Store {
  if (!_store) _store = new Store();
  return _store;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function cardsKey(p: string | null): string { return `flashcards:${p ?? 'default'}`; }
function countKey(p: string | null): string { return `flashcount:${p ?? 'default'}`; }
function contextKey(p: string | null): string { return `flashcontext:${p ?? 'default'}`; }

export function getFlashcards(projectPath: string | null): Flashcard[] {
  return store().get(cardsKey(projectPath), []) as Flashcard[];
}

export function clearFlashcards(projectPath: string | null): void {
  store().set(cardsKey(projectPath), []);
  store().set(countKey(projectPath), 0);
}

// Whether adding `n` tool calls to the running counter crosses a multiple of CARDS_EVERY. Pure
// arithmetic, exported for testing.
export function crossesThreshold(prevCount: number, n: number, every = CARDS_EVERY): boolean {
  if (n <= 0) return false;
  return Math.floor((prevCount + n) / every) > Math.floor(prevCount / every);
}

// Increment the per-project tool counter; returns true when a new card is due.
export function recordToolCalls(projectPath: string | null, n: number): boolean {
  const prev = store().get(countKey(projectPath), 0) as number;
  const due = crossesThreshold(prev, n);
  store().set(countKey(projectPath), prev + n);
  return due;
}

export function setLastContext(projectPath: string | null, text: string): void {
  store().set(contextKey(projectPath), (text || '').slice(0, 4000));
}

// Pure: the messages for a card-generation request. Kept separate so tests can assert the shape
// without a live client.
export function flashcardMessages(context: string): { system: string; user: string } {
  return {
    system:
      'You write one-sentence developer flashcards. Given recent activity in a coding session, ' +
      'capture ONE non-obvious, reusable thing worth remembering about this project — a structural ' +
      'fact, a convention, or a command that worked. One sentence, no preamble, no quotes.',
    user: `Recent session activity:\n\n${context || '(no context captured yet)'}\n\nWrite one flashcard sentence.`,
  };
}

// Pure: pull the plain text out of a model response's content array.
export function extractCardText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && typeof b === 'object' && (b as { type?: unknown }).type === 'text')
    .map((b) => String((b as { text?: unknown }).text ?? ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Generate a card from the last stored context and persist it. Returns null if nothing usable.
export async function generateFlashcard(
  anthropic: Anthropic,
  projectPath: string | null,
): Promise<Flashcard | null> {
  const context = store().get(contextKey(projectPath), '') as string;
  const { system, user } = flashcardMessages(context);
  try {
    const resp = await anthropic.messages.create({
      model: CARD_MODEL,
      max_tokens: 120,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = extractCardText(resp.content);
    if (!text) return null;
    const card: Flashcard = { id: uid(), text, timestamp: Date.now() };
    const cards = getFlashcards(projectPath);
    cards.push(card);
    store().set(cardsKey(projectPath), cards);
    return card;
  } catch {
    return null;
  }
}
