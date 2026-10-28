import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { ChatView } from './components/ChatView';
import { InputBar } from './components/InputBar';
import { SettingsPanel } from './components/SettingsPanel';
import ProjectDrawer from './components/ProjectDrawer';
import AskUserModal from './components/AskUserModal';
import ShareModal from './components/ShareModal';
import GameCanvas, { formatLapTime, type LapCard } from './components/GameCanvas';
import TeachModal from './components/TeachModal';
import RadialMenu from './components/RadialMenu';
import WritePreview from './components/WritePreview';
import Home, { type HomeNav } from './components/Home';
import { LiveSessionView } from './components/LiveSessionView';
import FolderPicker from './components/FolderPicker';
import type { PadFocus } from './hooks/usePadFocus';
import type { LiveSession, Machine, RemoteTarget } from './types';
import { SectorStrip } from './components/SectorStrip';
import { useFeedback } from './hooks/useFeedback';
import {
  resolveChord,
  radialIndexFromStick,
  commandForAction,
  RADIAL_ITEMS,
  CHORD_LABELS,
  type FaceButton,
  type RadialAction,
} from './lib/controls';
import { useClaude } from './hooks/useClaude';
import { useSeason } from './hooks/useSeason';
import { DRIVE_MODE_LABELS, nextDriveMode, normalizeModel } from '../main/engine/config';
import { useVoice } from './hooks/useVoice';
import { useLive } from './hooks/useLive';
import { useLiveSession } from './hooks/useLiveSession';
import { useLocalVoice } from './hooks/useLocalVoice';
import { useGamepad } from './hooks/useGamepad';
import { useStore } from './hooks/useStore';
import { useProject } from './hooks/useProject';
import { useTelemetry } from './hooks/useTelemetry';
import { EngineSettingsPayload, PendingWrite, PendingQuestion, TeachRequest } from './types';

interface TeachLogEntry { tool: string; why: string; timestamp: number; }

const MILESTONE_TOAST: Record<string, string> = {
  'tests-pass': '🟢 Tests passing',
  'tests-fail': '🔴 Tests failing',
  'build-pass': '✅ Build clean',
  'build-fail': '🟡 Build failing',
  commit: '📦 Committed',
  push: '🚀 Pushed',
};

const SESSION_TOKEN_BUDGET = 200_000;

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  // Cards wait their turn: a live session on the remote computer can ask while this one does.
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const pendingQuestion = questions[0] ?? null;
  const [pendingTeach, setPendingTeach] = useState<TeachRequest | null>(null);
  const [teachRedirectSignal, setTeachRedirectSignal] = useState(0);
  const [teachLog, setTeachLog] = useState<TeachLogEntry[]>([]);
  const [voiceRejecting, setVoiceRejecting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [cockpitOpen, setCockpitOpen] = useState(false);
  // Home is the launch screen; the chat takes over once a session is under way.
  const [showHome, setShowHome] = useState(true);
  const homeNav = useRef<HomeNav>(null);
  // A session running on the remote computer, open on the live session screen (from Home's LIVE rows).
  const [liveOpen, setLiveOpen] = useState<LiveSession | null>(null);
  const live = useLive();
  const liveChat = useLiveSession(liveOpen?.sessionId ?? null);
  const liveScrollRef = useRef<HTMLDivElement>(null);
  // Its latest state from the watcher (the one Home opened stays on screen if the session ends).
  const liveShown = (liveOpen && live?.state?.live.find((s) => s.sessionId === liveOpen.sessionId)) || liveOpen;
  const settingsNav = useRef<PadFocus | null>(null);
  // The in-app folder picker (the system dialog can't open in the Deck's Game Mode).
  const [folderPick, setFolderPick] = useState<null | { onPick: (p: string) => void; machine: Machine }>(null);
  const pickerNav = useRef<PadFocus | null>(null);
  // The cockpit's game menu (every game and mod); Start opens it while the cockpit is up.
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const gameMenuNav = useRef<PadFocus | null>(null);
  useEffect(() => { if (!cockpitOpen) setGameMenuOpen(false); }, [cockpitOpen]);
  const [engineReady, setEngineReady] = useState(true);
  const [apiKey, setApiKey] = useStore<string>('apiKey', '');
  const [previewPort, setPreviewPort] = useStore<number>('previewPort', 5757);
  const [previewHttps, setPreviewHttps] = useStore<boolean>('previewHttps', false);
  const [cockpitMode, setCockpitMode] = useStore<string>('cockpitMode', 'cockpit-flight');
  const [localVoice, setLocalVoice] = useStore<boolean>('localVoice', false);
  const [localReady, setLocalReady] = useState(false);
  const [teachMode, setTeachMode] = useStore<boolean>('teachMode', false);
  const [teachTimeout] = useStore<number>('teachTimeout', 5);
  const [haptics, setHaptics] = useStore<boolean>('haptics', true);
  const [sound, setSound] = useStore<boolean>('sound', true);
  const [collapseTools, setCollapseTools] = useState(false);
  const [radialOpen, setRadialOpen] = useState(false);
  const [radialIndex, setRadialIndex] = useState<number | null>(null);
  // Toasts queue so a level-up and the achievement that caused it both get seen.
  const [toasts, setToasts] = useState<string[]>([]);
  const toast = toasts[0] ?? null;

  const telemetry = useTelemetry();
  const fireFeedback = useFeedback({ haptics, sound });

  const showToast = useCallback((msg: string) => {
    setToasts((q) => (q.includes(msg) ? q : [...q, msg].slice(-4)));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToasts((q) => q.slice(1)), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);
  const [storedModel, setModel] = useStore<string>('model', 'sonnet');
  const model = normalizeModel(storedModel);
  const [extendedThinking, setExtendedThinking] = useStore<boolean>('extendedThinking', false);
  const [effort, setEffort] = useStore<string>('effort', 'high');

  const { projectPath, projectHost, files, refreshFiles, adoptProject } = useProject();
  // The remote computer from Settings (null when none is set up); reloaded when Settings closes.
  const [remoteTarget, setRemoteTarget] = useState<RemoteTarget | null>(null);
  useEffect(() => { if (!showSettings) void window.electronAPI.remoteGet().then(setRemoteTarget); }, [showSettings]);
  const hostFor = (machine: Machine) => (machine === 'remote' ? remoteTarget?.host ?? null : null);

  const engineSettings = useMemo<EngineSettingsPayload>(
    () => ({ model, effort, thinking: extendedThinking, teachMode, teachTimeout }),
    [model, effort, extendedThinking, teachMode, teachTimeout],
  );

  const {
    messages,
    sendMessage,
    isStreaming,
    error,
    notice,
    sessionUsage,
    costUsd,
    context,
    sectors,
    mode,
    setMode,
    rewindTo,
    resumeSession,
    abort,
    pitStop,
    clearMessages,
  } = useClaude({
    settings: engineSettings,
    onPendingWrite: setPendingWrite,
    onPendingQuestion: (q) => setQuestions((qs) => [...qs.filter((x) => x.id !== q.id), q]),
    onTeach: (req) => {
      setPendingTeach(req);
      setTeachRedirectSignal(0);
      setTeachLog((prev) => [...prev, { tool: req.tool, why: req.why, timestamp: Date.now() }]);
    },
    // The engine withdrew a card (interrupt / rewind): close it wherever it is showing.
    onPromptCancel: (id) => {
      setPendingWrite((w) => (w?.id === id ? null : w));
      setQuestions((qs) => qs.filter((q) => q.id !== id));
      setPendingTeach((t) => (t?.id === id ? null : t));
    },
  });

  // The career. Every outcome that earned something gets a toast; unlocks and level-ups rumble.
  const { season, record, lap, lastLap } = useSeason((u) => {
    if (u.levelUp) {
      fireFeedback('level-up');
      showToast(`LEVEL ${u.levelUp} · +${u.gained} XP`);
    } else if (u.unlocked.length) {
      fireFeedback('level-up');
    }
    for (const a of u.unlocked) showToast(`🏆 ${a.name} · ${a.blurb}`);
  });

  // Lap timing: a lap runs from the moment Claude starts streaming to the chequered flag.
  const lapStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (isStreaming && lapStartRef.current == null) lapStartRef.current = Date.now();
  }, [isStreaming]);
  const [lapCard, setLapCard] = useState<LapCard | null>(null);
  useEffect(() => {
    if (!lastLap) return;
    const ms = lapStartRef.current != null ? lastLap.at - lapStartRef.current : null;
    lapStartRef.current = null;
    setLapCard({ number: lastLap.number, xp: lastLap.xp, ms, checkpoints: lastLap.checkpoints });
    showToast(`✅ Claude finished${ms != null ? ` · ${formatLapTime(ms)}` : ''} · +${lastLap.xp} XP`);
  }, [lastLap, showToast]);
  // Without a plan from Claude, the strip shows what this lap (or the last one) actually achieved.
  const checkpoints = isStreaming ? lap.checkpoints : (lastLap?.checkpoints ?? []);

  const cycleMode = useCallback(() => {
    const next = nextDriveMode(mode);
    void setMode(next);
    showToast(`Permission mode: ${DRIVE_MODE_LABELS[next]}`);
  }, [mode, setMode, showToast]);

  // Engine health: checked at start and whenever settings close (an install may have happened).
  useEffect(() => {
    if (showSettings) return;
    void window.electronAPI.engineStatus().then((st) => {
      setEngineReady(st.found);
      if (!st.found) setShowSettings(true);
    }).catch(() => {});
  }, [showSettings]);

  useEffect(() => { if (notice) showToast(notice); }, [notice, showToast]);

  // The launch update check runs before anyone opens Settings: say so, with the headline change.
  useEffect(() => window.electronAPI.onUpdaterAvailable((info) => {
    const headline = info.notes[0]?.items[0];
    showToast(`⬆ AnthroDeck v${info.version} is out${headline ? ` · ${headline}` : ''} · Settings to update`);
  }), [showToast]);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const writeDiffRef = useRef<HTMLPreElement>(null);

  // Dictation goes to whichever session is on screen: a live one on the remote computer, or the chat.
  const sendLive = liveChat.send;
  const handleVoiceResult = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (liveOpen) void sendLive(text.trim());
      else sendMessage(text.trim());
    },
    [sendMessage, sendLive, liveOpen]
  );

  const { isListening, transcript, isSupported, startListening, stopListening } =
    useVoice(handleVoiceResult);
  const localDict = useLocalVoice(handleVoiceResult);

  // Decide the active dictation backend: local whisper when enabled AND ready, else Web Speech.
  useEffect(() => {
    if (!localVoice) { setLocalReady(false); return; }
    window.electronAPI.voiceLocalStatus()
      .then((s) => setLocalReady(s.ready))
      .catch(() => setLocalReady(false));
  }, [localVoice]);
  const useLocal = localVoice && localReady;
  // Some way to talk exists here: on-device whisper, or the system's speech recognition.
  const voiceReady = useLocal || isSupported;
  const startDictation = useLocal ? localDict.startListening : startListening;
  const stopDictation = useLocal ? localDict.stopListening : stopListening;
  const dictationListening = useLocal ? localDict.isListening : isListening;
  const transcribing = useLocal ? localDict.transcribing : false;

  const scrollChat = useCallback((delta: number) => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop += delta * 18;
  }, []);

  // Feed cumulative session tokens to the cockpit telemetry (drives trail length / progress).
  useEffect(() => {
    telemetry.setSessionTokens(
      sessionUsage.inputTokens + sessionUsage.outputTokens +
      sessionUsage.cacheReadTokens + sessionUsage.cacheCreationTokens,
    );
    telemetry.setBudget(SESSION_TOKEN_BUDGET);
  }, [sessionUsage, telemetry]);

  // Haptic + audio cues on engine events. Subscribes alongside useClaude (IPC allows multiple
  // listeners) so feedback stays decoupled from conversation state.
  useEffect(() => {
    const unsubTool = window.electronAPI.onClaudeToolActivity(() => fireFeedback('tool-success'));
    const unsubErr = window.electronAPI.onClaudeError(() => fireFeedback('tool-error'));
    const unsubDone = window.electronAPI.onClaudeDone(() => fireFeedback('message-complete'));
    const unsubWritten = window.electronAPI.onFileWritten(() => fireFeedback('write-applied'));
    const unsubEngine = window.electronAPI.onEngineEvent((ev) => {
      if (ev.type === 'sector-done') {
        fireFeedback('sector');
        showToast(`☑ Task done · ${ev.sector.title}`);
      }
      if (ev.type === 'milestone') {
        const good = ev.kind !== 'tests-fail' && ev.kind !== 'build-fail';
        fireFeedback(good ? 'write-applied' : 'tool-error');
        showToast(MILESTONE_TOAST[ev.kind]);
      }
    });
    return () => { unsubTool(); unsubErr(); unsubDone(); unsubWritten(); unsubEngine(); };
  }, [fireFeedback, showToast]);

  // Games act on the session here. Only non-destructive intents exist (see game/types.ts): a stray
  // flick of the stick must never approve a write. Claude Code manages its own context now, so a
  // cleanup intent (smash a hunter, sweep a node) is the pit crew calling the pilot in when the tank
  // is low. It never compacts by itself; that costs a model call and is the pilot's decision.
  const lastPitCall = useRef(0);
  const handleGameIntents = useCallback((intents: { type: string }[]) => {
    if (!intents.some((i) => i.type === 'prune-stale')) return;
    if (!context || context.percentage < 70) return;
    const now = Date.now();
    if (now - lastPitCall.current < 60_000) return;
    lastPitCall.current = now;
    showToast(`Context is ${Math.round(context.percentage)}% full. Radial → Compact.`);
    fireFeedback('tool-success');
  }, [context, showToast, fireFeedback]);

  // Meta actions reachable from the L1 chords and the radial menu.
  const runAction = useCallback(async (action: RadialAction) => {
    if (action === 'undo-write') {
      const r = await window.electronAPI.writeUndo();
      showToast(r.message);
      fireFeedback(r.ok ? 'write-applied' : 'tool-error');
      return;
    }
    if (action === 'pit-stop') {
      if (isStreaming) { showToast('Can\'t compact while Claude is working.'); return; }
      pitStop();
      showToast('Compacting context…');
      return;
    }
    if (action === 'drive-mode') { cycleMode(); return; }
    if (action === 'new-session') {
      // A new session starts at Home, where the project is picked.
      setShowHome(true);
      return;
    }
    if (action === 'git-commit') {
      // Commit needs a message — hand off to the drawer's git tab rather than guessing one.
      setDrawerOpen(true);
      showToast('Opened git panel — dictate a commit message.');
      return;
    }
    const cmd = commandForAction(action);
    if (!cmd) return;
    if (!projectPath) { showToast('Open a project first.'); return; }
    showToast(`${CHORD_LABELS[action as keyof typeof CHORD_LABELS] ?? action}…`);
    try {
      const res = await window.electronAPI.runShell(cmd, 'bash');
      const out = (res.stdout || res.stderr || res.error || '(no output)').trim();
      showToast(out.split('\n').slice(0, 3).join(' · ').slice(0, 200) || '(no output)');
      fireFeedback(res.error ? 'tool-error' : 'tool-success');
      // A test run the pilot fires themselves is as real as one Claude runs.
      if (action === 'run-tests') record({ type: 'milestone', kind: res.error ? 'tests-fail' : 'tests-pass' });
    } catch (e) {
      showToast(`Failed: ${(e as Error).message}`);
      fireFeedback('tool-error');
    }
  }, [projectPath, showToast, fireFeedback, isStreaming, pitStop, cycleMode, clearMessages, record]);

  // Clearing while streaming is an abort — that's a "crash" event for the cockpit.
  const handleClear = useCallback(() => {
    if (isStreaming) telemetry.emit({ type: 'crash' });
    clearMessages();
  }, [isStreaming, clearMessages, telemetry]);

  const handleWriteAccept = useCallback(() => {
    if (!pendingWrite) return;
    window.electronAPI.sendWriteDecision(pendingWrite.id, true);
    setPendingWrite(null);
    setVoiceRejecting(false);
    telemetry.emit({ type: 'boost' }); // approving a write is a boost
    record({ type: 'edit-approved' });
  }, [pendingWrite, telemetry, record]);

  const handleWriteReject = useCallback((feedback?: string) => {
    if (!pendingWrite) return;
    window.electronAPI.sendWriteDecision(pendingWrite.id, false, feedback);
    setPendingWrite(null);
    setVoiceRejecting(false);
  }, [pendingWrite]);

  // Dedicated voice channel for spoken write-rejection feedback (B button). Separate from the
  // main send-voice so a rejection never gets sent as a chat message.
  const rejectVoice = useVoice((text) => {
    setVoiceRejecting(false);
    handleWriteReject(text.trim() || undefined);
  });

  const answerQuestion = useCallback((value: string) => {
    if (!pendingQuestion) return;
    window.electronAPI.sendAskUserDecision(pendingQuestion.id, value);
    if ((pendingQuestion.kind ?? 'question') === 'question') record({ type: 'question-answered' });
    setQuestions((qs) => qs.filter((q) => q.id !== pendingQuestion.id));
  }, [pendingQuestion, record]);

  const teachContinue = useCallback(() => {
    if (!pendingTeach) return;
    window.electronAPI.sendTeachDecision(pendingTeach.id, 'continue');
    setPendingTeach(null);
  }, [pendingTeach]);

  const teachRedirect = useCallback((instruction: string) => {
    if (!pendingTeach) return;
    window.electronAPI.sendTeachDecision(pendingTeach.id, 'redirect', instruction);
    setPendingTeach(null);
  }, [pendingTeach]);

  const modalActive = !!pendingWrite || !!pendingQuestion || !!pendingTeach;
  // When the cockpit game is open it owns the controller; App-level bindings stand down. A card
  // always wins: the game pauses, the face buttons answer it, and play resumes. That is the loop:
  // play while Claude drives, answer when it radios in.
  const padBusy = modalActive || cockpitOpen;
  // With the game menu up, the pad drives the menu instead of the game.
  const menuOwnsPad = cockpitOpen && gameMenuOpen && !modalActive;
  const gameOwnsPad = cockpitOpen && !modalActive && !gameMenuOpen;
  // Home takes the D-pad and A/B while it's up and nothing else is asking.
  // The folder picker sits over everything else, so it comes first.
  const pickerOwnsPad = !!folderPick && !modalActive;
  const homeOwnsPad = showHome && !liveOpen && !cockpitOpen && !modalActive && !showSettings && !drawerOpen && !folderPick;
  // The live session screen: B back to Home, A to the message box, D-pad and right stick scroll.
  const liveOwnsPad = !!liveOpen && !cockpitOpen && !modalActive && !showSettings && !drawerOpen && !folderPick;
  const scrollLive = (px: number) => { if (liveScrollRef.current) liveScrollRef.current.scrollTop += px; };
  // Settings takes the D-pad and A while it's open (B already closes it).
  const settingsOwnsPad = showSettings && !cockpitOpen && !modalActive && !drawerOpen && !folderPick;

  // L1 + face button fires a meta action instead of the button's normal job. Returns true when the
  // chord consumed the press.
  const tryChord = useCallback((modifier: boolean, button: FaceButton): boolean => {
    const action = resolveChord(modifier, button);
    if (!action) return false;
    void runAction(action);
    return true;
  }, [runAction]);

  useGamepad({
    // L2 push-to-talk only drives chat when nothing else owns the pad.
    onL2Press: () => {
      if (padBusy) return;
      if (!voiceReady) {
        showToast('Voice isn\'t set up on this device yet (Settings → Voice). STEAM + X opens the keyboard.');
        return;
      }
      // Off the message box first: SteamOS raises its keyboard whenever a focused text box changes
      // state, and the box goes read-only while listening.
      if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
      startDictation();
      fireFeedback('voice-start');
    },
    onL2Release: () => {
      if (padBusy || !voiceReady) return;
      stopDictation();
      fireFeedback('voice-stop');
    },
    onAPress: (mod) => {
      if (menuOwnsPad) { gameMenuNav.current?.activate(); return; }
      if (gameOwnsPad) return;
      if (!cockpitOpen && tryChord(mod, 'A')) return;
      if (pickerOwnsPad) { pickerNav.current?.activate(); return; }
      if (homeOwnsPad) { homeNav.current?.activate(); return; }
      if (liveOwnsPad) { document.querySelector<HTMLTextAreaElement>('.live-composer textarea')?.focus(); return; }
      if (settingsOwnsPad) { settingsNav.current?.activate(); return; }
      if (pendingTeach) teachContinue();
      else if (pendingWrite) handleWriteAccept();
      else if (pendingQuestion) answerOption(0);
    },
    onXPress: (mod) => {
      if (gameOwnsPad) return;
      if (!cockpitOpen && tryChord(mod, 'X')) return;
      if (pendingWrite) handleWriteReject();
      else if (pendingQuestion) answerOption(2);
    },
    onBPress: (mod) => {
      if (menuOwnsPad) { setGameMenuOpen(false); return; }
      if (gameOwnsPad) return;
      if (!cockpitOpen && tryChord(mod, 'B')) return;
      // On Home, B goes back to the current session (when there is one).
      if (pickerOwnsPad) { setFolderPick(null); return; }
      if (homeOwnsPad) { if (messages.length) setShowHome(false); return; }
      if (liveOwnsPad) { setLiveOpen(null); return; }
      if (pendingTeach) { setTeachRedirectSignal((s) => s + 1); return; }
      if (pendingWrite) {
        // Toggle spoken-rejection push-to-talk.
        if (voiceRejecting) {
          rejectVoice.stopListening();
        } else {
          setVoiceRejecting(true);
          rejectVoice.startListening();
        }
      } else if (pendingQuestion) {
        answerOption(1);
      } else if (!cockpitOpen) {
        setShowSettings((s) => !s);
      }
    },
    onYPress: (mod) => {
      if (homeOwnsPad) { homeNav.current?.switchMachine(); return; }
      if (gameOwnsPad) return;
      if (!cockpitOpen && tryChord(mod, 'Y')) return;
      if (pendingQuestion) answerOption(3);
      else if (!cockpitOpen) setDrawerOpen((s) => !s);
    },
    // Start: Settings normally; in the cockpit it opens and closes the game menu.
    onStartPress: () => {
      if (cockpitOpen) { if (!modalActive) setGameMenuOpen((o) => !o); }
      else setShowSettings((s) => !s);
    },
    // R1 paddle: drive mode, even mid-game (the games don't use it). L1+R2: the brake.
    // (Not on the live session screen: that session's mode is set where it runs.)
    onR1Press: () => { if (!modalActive && !liveOpen) cycleMode(); },
    onR2Press: (mod) => {
      if (!mod || cockpitOpen || !isStreaming) return;
      abort();
      telemetry.emit({ type: 'crash' });
      showToast('Brake: Claude interrupted.');
    },
    // L3 / R3 — quick panel toggles.
    onL3Press: () => { if (!cockpitOpen && !modalActive) setDrawerOpen((s) => !s); },
    onR3Press: () => { if (!cockpitOpen && !modalActive) setShowSettings((s) => !s); },
    // D-pad: up/down scrolls a pending diff; left/right collapses/expands tool detail lines.
    onDpadUp: () => {
      if (menuOwnsPad) gameMenuNav.current?.move('up');
      else if (pickerOwnsPad) pickerNav.current?.move('up');
      else if (settingsOwnsPad) settingsNav.current?.move('up');
      else if (homeOwnsPad) homeNav.current?.move(0, -1);
      else if (liveOwnsPad) scrollLive(-160);
      else if (pendingWrite && writeDiffRef.current) writeDiffRef.current.scrollTop -= 48;
    },
    onDpadDown: () => {
      if (menuOwnsPad) gameMenuNav.current?.move('down');
      else if (pickerOwnsPad) pickerNav.current?.move('down');
      else if (settingsOwnsPad) settingsNav.current?.move('down');
      else if (homeOwnsPad) homeNav.current?.move(0, 1);
      else if (liveOwnsPad) scrollLive(160);
      else if (pendingWrite && writeDiffRef.current) writeDiffRef.current.scrollTop += 48;
    },
    onDpadLeft: () => {
      if (menuOwnsPad) gameMenuNav.current?.move('left');
      else if (pickerOwnsPad) pickerNav.current?.move('left');
      else if (settingsOwnsPad) settingsNav.current?.move('left');
      else if (homeOwnsPad) homeNav.current?.move(-1, 0);
      else if (!cockpitOpen && !pendingWrite) setCollapseTools(true);
    },
    onDpadRight: () => {
      if (menuOwnsPad) gameMenuNav.current?.move('right');
      else if (pickerOwnsPad) pickerNav.current?.move('right');
      else if (settingsOwnsPad) settingsNav.current?.move('right');
      else if (homeOwnsPad) homeNav.current?.move(1, 0);
      else if (!cockpitOpen && !pendingWrite) setCollapseTools(false);
    },
    // Radial menu: hold Select (Steam Input can map trackpad center-click here), aim, release.
    onRadialOpen: () => { if (!cockpitOpen && !modalActive) { setRadialOpen(true); setRadialIndex(null); } },
    onRadialAim: (x, y) => { if (radialOpen) setRadialIndex(radialIndexFromStick(x, y, RADIAL_ITEMS.length)); },
    onRadialClose: () => {
      if (!radialOpen) return;
      setRadialOpen(false);
      if (radialIndex !== null) {
        const item = RADIAL_ITEMS[radialIndex];
        if (item) void runAction(item.action);
      }
      setRadialIndex(null);
    },
    // Right stick: scrolls whichever panel is up (the ring follows), otherwise the chat.
    onScrollY: (d) => {
      if (pickerOwnsPad) pickerNav.current?.scroll(d * 18);
      else if (settingsOwnsPad) settingsNav.current?.scroll(d * 18);
      else if (liveOwnsPad) scrollLive(d * 18);
      else if (!cockpitOpen) scrollChat(d);
    },
  });

  function answerOption(index: number) {
    const opt = pendingQuestion?.options[index];
    if (opt) answerQuestion(opt.value);
  }

  // ─── Home actions ──────────────────────────────────────────────────────────
  const currentSession = useMemo(() => {
    const first = messages.find((m) => m.role === 'user');
    if (!first) return null;
    const title = first.content.replace(/\s+/g, ' ').trim();
    return {
      title: title.length > 80 ? `${title.slice(0, 79)}…` : title,
      project: projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() ?? null : null,
    };
  }, [messages, projectPath]);

  const openSession = useCallback(async (s: { id: string; cwd: string; title: string }, machine: Machine = 'local') => {
    if (isStreaming) { showToast('Claude is still working. Stop it first, or wait for it to finish.'); return; }
    if (machine === 'remote') showToast(`Connecting to ${remoteTarget?.label ?? 'your other computer'}…`);
    const err = await resumeSession(s.id, s.cwd, machine);
    if (err) { showToast(err); return; }
    await adoptProject(s.cwd, hostFor(machine));
    setShowHome(false);
    showToast(`Resumed · ${s.title}${machine === 'remote' ? ` · on ${remoteTarget?.label}` : ''}`);
  }, [isStreaming, resumeSession, adoptProject, showToast, remoteTarget]);

  const startSession = useCallback(async (cwd: string, machine: Machine = 'local') => {
    if (isStreaming) { showToast('Claude is still working. Stop it first, or wait for it to finish.'); return; }
    const host = hostFor(machine);
    if (cwd !== projectPath || host !== projectHost) await adoptProject(cwd, host);
    clearMessages();
    setShowHome(false);
    showToast(machine === 'remote' ? `New session on ${remoteTarget?.label}.` : 'New session.');
  }, [isStreaming, projectPath, projectHost, adoptProject, clearMessages, showToast, remoteTarget]);

  // Inject file path into input when user taps a file in the drawer
  const handleFileClick = useCallback((file: string) => {
    sendMessage(`Read the file ${file} and tell me about it`);
    setDrawerOpen(false);
  }, [sendMessage]);

  // Auto-scroll to bottom on new messages, and when an edit card arrives (it renders at the end of
  // the chat, and the pilot must see it to approve it).
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, pendingWrite]);

  return (
    <div className="app-root">
      <StatusBar
        isListening={dictationListening}
        isTranscribing={transcribing}
        isStreaming={isStreaming}
        engineReady={engineReady}
        projectPath={projectPath}
        projectHostLabel={projectHost ? remoteTarget?.label ?? projectHost : null}
        usage={sessionUsage}
        budget={SESSION_TOKEN_BUDGET}
        contextPct={context?.percentage ?? null}
        costUsd={costUsd}
        mode={mode}
        liveMode={liveShown ? liveChat.mode : undefined}
        onCycleMode={cycleMode}
        career={{ level: season.level, tier: season.tier, progress: season.progress }}
        onDrawer={() => setDrawerOpen((s) => !s)}
        onSettings={() => setShowSettings((s) => !s)}
        onCockpit={() => setCockpitOpen((s) => !s)}
        onHome={() => { setShowSettings(false); setShowHome(true); }}
      />
      <SectorStrip sectors={sectors} checkpoints={checkpoints} />

      {/* Project drawer (slides in from left, over content) */}
      <ProjectDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        projectPath={projectPath}
        projectRemote={projectHost ? remoteTarget?.label ?? projectHost : null}
        files={files}
        onOpenFolder={() => setFolderPick({ machine: 'local', onPick: (p) => { setFolderPick(null); void adoptProject(p); } })}
        onRefreshFiles={refreshFiles}
        autonomousWrites={mode === 'acceptEdits'}
        onToggleAutonomous={() => void setMode(mode === 'acceptEdits' ? 'default' : 'acceptEdits')}
        onFileClick={handleFileClick}
        sectors={sectors}
        context={context}
        season={season}
        onPitStop={() => { setDrawerOpen(false); pitStop(); }}
        isStreaming={isStreaming}
        onShare={() => { setDrawerOpen(false); setShareOpen(true); }}
        teachLog={teachLog}
      />

      {showSettings ? (
        <SettingsPanel
          padNav={settingsNav}
          apiKey={apiKey}
          onSave={async (key) => { await setApiKey(key); setShowSettings(false); }}
          onPaired={async () => {
            const k = (await window.electronAPI.storeGet('apiKey')) as string | undefined;
            if (k) await setApiKey(k);
          }}
          onClear={handleClear}
          onClose={() => setShowSettings(false)}
          model={model}
          onModelChange={setModel}
          extendedThinking={extendedThinking}
          onExtendedThinkingChange={setExtendedThinking}
          effort={effort}
          onEffortChange={setEffort}
          localVoice={localVoice}
          onLocalVoiceChange={setLocalVoice}
          teachMode={teachMode}
          onTeachModeChange={setTeachMode}
          previewPort={previewPort}
          onPreviewPortChange={setPreviewPort}
          previewHttps={previewHttps}
          onPreviewHttpsChange={setPreviewHttps}
          haptics={haptics}
          onHapticsChange={setHaptics}
          sound={sound}
          onSoundChange={setSound}
        />
      ) : liveShown ? (
        <LiveSessionView
          session={liveShown}
          label={live?.label ?? remoteTarget?.label ?? 'your other computer'}
          waiting={live?.state?.requests.filter((r) => r.sessionId === liveShown.sessionId).length ?? 0}
          connected={!!live?.connected}
          entries={liveChat.entries}
          mode={liveChat.mode}
          outgoing={liveChat.outgoing}
          onDismiss={liveChat.dismiss}
          scrollRef={liveScrollRef}
          onBack={() => setLiveOpen(null)}
          composer={
            <InputBar
              onSend={(text) => void sendLive(text)}
              isStreaming={false}
              isListening={dictationListening}
              transcript={useLocal ? '' : transcript}
              isVoiceSupported={isSupported || useLocal}
              onVoiceStart={startDictation}
              onVoiceStop={stopDictation}
            />
          }
        />
      ) : showHome ? (
        <Home
          ref={homeNav}
          projectPath={projectPath}
          projectHost={projectHost}
          current={currentSession}
          onContinue={() => setShowHome(false)}
          onResume={(s, machine) => void openSession(s, machine)}
          onNew={(cwd, machine) => void startSession(cwd, machine)}
          onOpenFolder={(machine) => setFolderPick({ machine, onPick: (p) => { setFolderPick(null); void startSession(p, machine); } })}
          onOpenLive={setLiveOpen}
        />
      ) : (
        <>
          <ChatView
            messages={messages}
            error={error}
            scrollRef={chatScrollRef}
            isStreaming={isStreaming}
            pendingWrite={pendingWrite}
            onWriteAccept={handleWriteAccept}
            onWriteReject={handleWriteReject}
            // Mid-game the edit card renders over the cockpit instead; only one copy owns the ref.
            writeDiffRef={cockpitOpen ? undefined : writeDiffRef}
            voiceRejecting={voiceRejecting}
            onRewind={rewindTo}
            collapseTools={collapseTools}
          />
          <InputBar
            onSend={sendMessage}
            isStreaming={isStreaming}
            isListening={dictationListening}
            transcript={useLocal ? '' : transcript}
            isVoiceSupported={isSupported || useLocal}
            onVoiceStart={startDictation}
            onVoiceStop={stopDictation}
          />
        </>
      )}

      {/* ask_user modal — Claude paused to ask the pilot a question */}
      {pendingQuestion && (
        <AskUserModal question={pendingQuestion} onSelect={answerQuestion} />
      )}

      {/* Teach mode — Claude is about to run a tool */}
      {pendingTeach && (
        <TeachModal
          req={pendingTeach}
          onContinue={teachContinue}
          onRedirect={teachRedirect}
          redirectSignal={teachRedirectSignal}
        />
      )}

      {/* Share preview over LAN */}
      {shareOpen && (
        <ShareModal
          onClose={() => setShareOpen(false)}
          port={previewPort}
          onPortChange={setPreviewPort}
          https={previewHttps}
          onHttpsChange={setPreviewHttps}
        />
      )}

      {/* Radial menu (hold Select / trackpad center-click) */}
      {radialOpen && <RadialMenu selected={radialIndex} />}

      {/* Transient toast for chord / radial results */}
      {toast && (
        <div className="toast-in" style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          zIndex: 90, maxWidth: '80%',
          background: '#1A1A1A', border: '1px solid #3A3A3A', borderRadius: 10,
          padding: '10px 16px', color: '#ECECEC', fontSize: 13,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', pointerEvents: 'none',
          whiteSpace: 'pre-wrap', fontFamily: 'monospace',
        }}>
          {toast}
        </div>
      )}

      {/* Cockpit game layer — pauses when an approval modal is up */}
      {cockpitOpen && (
        <GameCanvas
          onClose={() => setCockpitOpen(false)}
          selectedId={cockpitMode}
          onSelect={setCockpitMode}
          telemetry={telemetry}
          paused={modalActive}
          menuOpen={gameMenuOpen}
          onMenu={setGameMenuOpen}
          menuNav={gameMenuNav}
          onIntents={handleGameIntents}
          sectors={sectors}
          checkpoints={checkpoints}
          lapCard={lapCard}
          career={{ level: season.level, tier: season.tier, progress: season.progress }}
          driveMode={mode}
        />
      )}

      {folderPick && (
        <FolderPicker
          padNav={pickerNav}
          machine={folderPick.machine}
          title={folderPick.machine === 'remote' ? `Open a folder on ${remoteTarget?.label ?? 'your other computer'}` : undefined}
          onPick={folderPick.onPick}
          onCancel={() => setFolderPick(null)}
        />
      )}

      {/* An edit card raised mid-game: shown over the cockpit so the pilot can answer it with the
          face buttons and get straight back to the track. */}
      {cockpitOpen && pendingWrite && (
        <div className="overlay-in" style={{
          position: 'fixed', inset: 0, zIndex: 82, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{ width: '100%', maxWidth: 820, maxHeight: '90%', overflowY: 'auto' }}>
            <WritePreview
              write={pendingWrite}
              onAccept={handleWriteAccept}
              onReject={handleWriteReject}
              contentRef={writeDiffRef}
              voiceRejecting={voiceRejecting}
            />
          </div>
        </div>
      )}
    </div>
  );
}
