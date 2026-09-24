import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Emulator, EmulatorSystem } from '../systems';
import { systemForFile } from '../systems';
import AudioOutput from './audio/audioOutput';
import ConsoleMenu from './ConsoleMenu';
import Player from './Player';
import { DEFAULT_ROM, type RomEntry } from './romLibrary';
import { readSave, writeSave } from './saves';

const DEBUG_REFRESH_MS = 100;
const MAX_FRAMES_PER_TICK = 4;
const SAVE_CHECK_MS = 1000;
const THEATER_KEY = 'theaterMode';
const VOLUME_KEY = 'volume';

interface Game {
    system: EmulatorSystem;
    emulator: Emulator;
    title: string;
    url: string | null;
    warning?: string;
}

const audio = new AudioOutput();
let bEmulationRun = false;

// Has to be called from a user gesture
function startAudio(emulator: Emulator | undefined): void {
    audio.start()
        .then(() => emulator?.setSampleRate(audio.sampleRate!))
        .catch(e => console.warn('Audio is not available', e));
}

// Keys typed into controls like the menu shouldn't reach the emulator
function isFormControl(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('input, button, select, textarea') !== null;
}

// Stores a game's save RAM if it changed
function flushSave(emulator: Emulator | undefined): void {
    const id = emulator?.saveId;
    const data = id ? emulator.takeSave?.() : null;
    if (id && data) writeSave(id, data);
}

// Per-browser preferences, so storage may not be there
function readSetting(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function storeSetting(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Not remembered then
    }
}

function readVolume(): number {
    const volume = Number(readSetting(VOLUME_KEY) ?? 1);
    return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
}

function titleOf(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.slice(0, dot) : fileName;
}

const App = () => {
    const [game, setGame] = useState<Game | null>(null);
    const [romError, setRomError] = useState<string | null>(null);
    const [muted, setMuted] = useState(false);
    // The screen across the page, with the debugger below, like a video site's theater mode
    const [theater, setTheater] = useState(() => readSetting(THEATER_KEY) === 'true');
    const [volume, setVolumeState] = useState(() => {
        const volume = readVolume();
        audio.setVolume(volume);
        return volume;
    });
    const [fullscreen, setFullscreen] = useState(false);
    // Mirrors bEmulationRun, which the emulation loop reads, for the controls
    const [running, setRunningState] = useState(false);
    const screenRef = useRef<HTMLDivElement>(null);
    // Re-renders the debugger, which reads the emulator state directly
    const [, refreshDebugger] = useReducer((n: number) => n + 1, 0);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<ImageData | null>(null);
    const gameRef = useRef<Game | null>(null);
    gameRef.current = game;

    const drawScreen = useCallback(() => {
        const emulator = gameRef.current?.emulator;
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!emulator || !canvas || !context) return;

        // The frame's size can change as the game runs, like the SNES with interlace
        const { width, height } = emulator;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        let frame = frameRef.current;
        if (frame?.width !== width || frame.height !== height) {
            frame = frameRef.current = context.createImageData(width, height);
        }
        emulator.drawFrame(frame);
        context.putImageData(frame, 0, 0);
    }, []);

    const loadGame = useCallback(async (system: EmulatorSystem, title: string, url: string | null, data: ArrayBuffer) => {
        if (!system.create) {
            setRomError(`${title}: ${system.shortName} emulation is not available yet.`);
            return;
        }
        const emulator = system.create();
        let warning: string | undefined;
        try {
            warning = emulator.load(data).warning;
        } catch (e) {
            setRomError(`Could not load ${title}: ${e instanceof Error ? e.message : e}`);
            return;
        }
        flushSave(gameRef.current?.emulator);
        // The save goes in before the game runs, which reads it as it starts
        if (emulator.saveId) {
            const save = await readSave(emulator.saveId);
            if (save) emulator.loadSave?.(save);
        }
        if (audio.sampleRate) emulator.setSampleRate(audio.sampleRate);
        audio.clear();
        setGame({ system, emulator, title, url, warning });
        setRomError(null);
    }, []);

    const loadRom = useCallback(async (rom: RomEntry) => {
        try {
            const response = await fetch(rom.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await loadGame(rom.system, rom.title, rom.url, await response.arrayBuffer());
        } catch (e) {
            setRomError(`Could not load ${rom.title}: ${e instanceof Error ? e.message : e}`);
        }
    }, [loadGame]);

    const openFile = useCallback(async (file: File) => {
        const system = systemForFile(file.name);
        if (!system) {
            setRomError(`${file.name} is not a ROM of a supported console.`);
            return;
        }
        await loadGame(system, titleOf(file.name), null, await file.arrayBuffer());
    }, [loadGame]);

    const setRunning = useCallback((run: boolean) => {
        bEmulationRun = run;
        setRunningState(run);
        if (run) {
            startAudio(gameRef.current?.emulator);
        } else {
            audio.clear();
        }
    }, []);

    const toggleRun = useCallback(() => setRunning(!bEmulationRun), [setRunning]);

    // Pauses, like stepping frame by frame in a video
    const stepFrame = useCallback(() => {
        const emulator = gameRef.current?.emulator;
        if (!emulator) return;
        setRunning(false);
        if (!emulator.handleDebugKey?.('KeyF')) emulator.runFrame();
        drawScreen();
        refreshDebugger();
    }, [setRunning, drawScreen]);

    const resetGame = useCallback(() => {
        gameRef.current?.emulator.reset();
        refreshDebugger();
    }, []);

    const toggleTheater = useCallback(() => {
        setTheater(on => {
            storeSetting(THEATER_KEY, String(!on));
            return !on;
        });
    }, []);

    const toggleFullscreen = useCallback(() => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            screenRef.current?.requestFullscreen().catch(e => console.warn('Full screen is not available', e));
        }
    }, []);

    // Escape leaves full screen without going through the button
    useEffect(() => {
        const update = () => setFullscreen(document.fullscreenElement !== null);
        document.addEventListener('fullscreenchange', update);
        return () => document.removeEventListener('fullscreenchange', update);
    }, []);

    // The screen moves to a new canvas when the layout changes, which starts out blank
    useEffect(() => {
        drawScreen();
    }, [theater, drawScreen]);

    // Turning the volume up unmutes, like a video player
    const changeVolume = useCallback((level: number) => {
        audio.setVolume(level);
        setVolumeState(level);
        storeSetting(VOLUME_KEY, String(level));
        if (level > 0 && audio.isMuted) {
            audio.setMuted(false);
            setMuted(false);
        }
    }, []);

    const toggleMute = useCallback(() => {
        const mute = !audio.isMuted;
        audio.setMuted(mute);
        setMuted(mute);
        startAudio(gameRef.current?.emulator);
    }, []);

    useEffect(() => {
        loadRom(DEFAULT_ROM);
    }, [loadRom]);

    // Games write their save RAM as they play, it's stored when it changed, and when leaving the page
    useEffect(() => {
        const flush = () => flushSave(gameRef.current?.emulator);
        const flushWhenHidden = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        const interval = setInterval(flush, SAVE_CHECK_MS);
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', flushWhenHidden);
        return () => {
            clearInterval(interval);
            window.removeEventListener('pagehide', flush);
            document.removeEventListener('visibilitychange', flushWhenHidden);
        };
    }, []);

    // A new game starts with a blank screen until its first frame
    useEffect(() => {
        const canvas = canvasRef.current;
        canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    }, [game]);

    useEffect(() => {
        function handleControllerKey(event: KeyboardEvent): boolean {
            const current = gameRef.current;
            const button = current?.system.keyMap[event.code];
            if (!current || button === undefined) return false;

            if (event.type === 'keydown') {
                if (isFormControl(event.target)) return false;
                current.emulator.setButton(0, button, true);
            } else {
                // Always release, the key may have been pressed before focus moved
                current.emulator.setButton(0, button, false);
            }
            event.preventDefault();
            return true;
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (handleControllerKey(event) || isFormControl(event.target)) return;
            const emulator = gameRef.current?.emulator;

            // Stepping a frame pauses, and lets the system step its own way
            if (event.code === 'KeyF') {
                stepFrame();
                return;
            }
            if (emulator?.handleDebugKey?.(event.code)) {
                drawScreen();
                refreshDebugger();
                return;
            }

            switch (event.code) {
                case 'Space':
                    event.preventDefault();
                    toggleRun();
                    break;
                case 'KeyT':
                    toggleTheater();
                    break;
                case 'KeyM':
                    toggleMute();
                    break;
                case 'KeyR':
                    resetGame();
                    break;
                default:
                    return;
            }
            refreshDebugger();
        }

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleControllerKey);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleControllerKey);
        };
    }, [drawScreen, toggleMute, toggleRun, stepFrame, resetGame, toggleTheater]);

    useEffect(() => {
        let lastDebugUpdate = 0;
        let startTime: number | null = null;
        let framesDone = 0;
        let requestId = 0;

        function tick(now: number) {
            requestId = requestAnimationFrame(tick);
            const emulator = gameRef.current?.emulator;
            if (!bEmulationRun || !emulator) {
                startTime = null;
                // Drops the sound of stepping while paused
                emulator?.takeSamples();
                return;
            }
            if (startTime === null) {
                startTime = now;
                framesDone = 0;
            }

            // Emulate as many frames as real time asks for, so sound is generated at the right rate
            const frameMs = 1000 / emulator.frameRate;
            let framesDue = Math.floor((now - startTime) / frameMs) - framesDone;
            if (framesDue > MAX_FRAMES_PER_TICK) {
                // Far behind, e.g. the tab was in the background, so skip ahead instead
                framesDone += framesDue - 1;
                framesDue = 1;
            }
            for (let i = 0; i < framesDue; i++) {
                emulator.runFrame();
                framesDone++;
                const samples = emulator.takeSamples();
                if (audio.ready) audio.push(samples);
            }
            if (framesDue === 0) return;

            drawScreen();
            // Refreshing the debug views every frame is too fast to read and slows down emulation
            if (now - lastDebugUpdate >= DEBUG_REFRESH_MS) {
                lastDebugUpdate = now;
                refreshDebugger();
            }
        }

        requestId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(requestId);
    }, [drawScreen]);

    const Debugger = game?.emulator.Debugger;
    const screen = game && (
        <div className={theater ? 'screen theater' : 'screen'} ref={screenRef}>
            <Player
                canvasRef={canvasRef}
                width={game.emulator.width}
                height={game.emulator.height}
                running={running}
                muted={muted}
                volume={volume}
                theater={theater}
                fullscreen={fullscreen}
                onToggleRun={toggleRun}
                onStepFrame={stepFrame}
                onReset={resetGame}
                onToggleMute={toggleMute}
                onVolumeChange={changeVolume}
                onToggleTheater={toggleTheater}
                onToggleFullscreen={toggleFullscreen}
            />
        </div>
    );
    const help = game && (
        <>
            <code className="instructions">SPACE = Run/Pause    F = Step Frame    R = Reset    M = Mute    T = Theater mode</code>
            <code className="instructions">Controller: {game.system.controlsHelp}</code>
            <code className="instructions">Click the screen to run or pause, double-click for full screen</code>
        </>
    );
    // In theater mode the screen goes across the page, above the debugger
    const column = theater ? help : <>{screen}{help}</>;

    return (
        <div className="gameArea">
            <header className="header">
                <ConsoleMenu
                    system={game?.system ?? DEFAULT_ROM.system}
                    title={game?.title ?? null}
                    currentUrl={game?.url ?? null}
                    onSelectRom={loadRom}
                    onOpenFile={openFile}
                />
            </header>
            {romError && <p className="message error">{romError}</p>}
            {game?.warning && <p className="message">{game.warning}</p>}
            {game ?
                <>
                    {theater && screen}
                    <div className="container">
                        {Debugger ? <Debugger>{column}</Debugger> : <div className="column">{column}</div>}
                    </div>
                </>
                : !romError && <p className="message">Loading…</p>}
        </div>
    );
};

export default App;
