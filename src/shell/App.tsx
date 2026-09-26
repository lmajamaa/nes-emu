import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Emulator, EmulatorSystem, LoadResult } from '../systems';
import { systemForFile } from '../systems';
import AudioOutput from './audio/audioOutput';
import ConsoleMenu from './ConsoleMenu';
import { DocsDialog, useDocsRoute } from './Docs';
import { FrameStats } from './frameStats';
import { padButtons, padName, PlayerInput, playerPads, type PadState } from './input';
import Player from './Player';
import TouchControls, { useTouchScreen } from './TouchControls';
import ProjectInfo from './ProjectInfo';
import { DEFAULT_ROM, type RomEntry } from './romLibrary';
import { readSave, writeSave } from './saves';

const DEBUG_REFRESH_MS = 100;
const MAX_FRAMES_PER_TICK = 4;
const SAVE_CHECK_MS = 1000;
const THEATER_KEY = 'theaterMode';
const VOLUME_KEY = 'volume';
const DEBUGGER_KEY = 'debugger';
const HOME_SCREEN_TIP = 'This browser can’t show pages full screen on iPhone. To play without its toolbars, ' +
    'add the emulator to your Home Screen from the Share menu, and open it from there.';

// Opened from the Home Screen, as an app without the browser's toolbars
function isInstalled(): boolean {
    return matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

interface Game extends LoadResult {
    system: EmulatorSystem;
    emulator: Emulator;
    title: string;
    url: string | null;
}

const audio = new AudioOutput();
const input = new PlayerInput();
const frameStats = new FrameStats();
let emulationRunning = false;

// Gamepads only show up once one of their buttons is pressed
function readPads(): readonly (PadState | null)[] {
    return navigator.getGamepads?.() ?? [];
}

// Browsers only let a page play sound once the user has interacted with it, so until then this waits
function startAudio(emulator: Emulator | undefined): void {
    if (!navigator.userActivation.hasBeenActive) return;
    audio.start()
        .then(() => emulator?.setSampleRate(audio.sampleRate!))
        .catch(e => console.warn('Audio is not available', e));
}

// Keys typed into controls like the menu, or while reading the docs, shouldn't reach the emulator
function isFormControl(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('input, button, select, textarea, dialog') !== null;
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
    // The connected gamepads' names, in player order
    const [padNames, setPadNames] = useState<string[]>([]);
    // A note for the player that stays until closed
    const [tip, setTip] = useState<string | null>(null);
    const touch = useTouchScreen();
    // Remembered, and hidden at first on touch screens, where there's little room for it
    const [debuggerShown, setDebuggerShown] = useState(() => {
        const setting = readSetting(DEBUGGER_KEY);
        return setting === null ? !matchMedia('(pointer: coarse)').matches : setting === 'true';
    });
    // Mirrors emulationRunning, which the emulation loop reads, for the controls
    const [running, setRunningState] = useState(false);
    const screenRef = useRef<HTMLDivElement>(null);
    const touchPlayRef = useRef<HTMLDivElement>(null);
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

    // Returns whether the game was loaded
    const loadGame = useCallback(async (system: EmulatorSystem, title: string, url: string | null, data: ArrayBuffer) => {
        if (!system.create) {
            setRomError(`${title}: ${system.shortName} emulation is not available yet.`);
            return false;
        }
        const emulator = system.create();
        let result: LoadResult;
        try {
            result = emulator.load(data);
        } catch (e) {
            setRomError(`Could not load ${title}: ${e instanceof Error ? e.message : e}`);
            return false;
        }
        flushSave(gameRef.current?.emulator);
        // The save goes in before the game runs, which reads it as it starts
        if (emulator.saveId) {
            const save = await readSave(emulator.saveId);
            if (save) emulator.loadSave?.(save);
        }
        if (audio.sampleRate) emulator.setSampleRate(audio.sampleRate);
        audio.clear();
        const loaded = { system, emulator, title, url, ...result };
        // Right away rather than on the next render, for starting it straight after
        gameRef.current = loaded;
        // Buttons already held carry over to the new game
        input.forget();
        input.apply(emulator);
        setGame(loaded);
        setRomError(null);
        return true;
    }, []);

    const loadRom = useCallback(async (rom: RomEntry) => {
        try {
            const response = await fetch(rom.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await loadGame(rom.system, rom.title, rom.url, await response.arrayBuffer());
        } catch (e) {
            setRomError(`Could not load ${rom.title}: ${e instanceof Error ? e.message : e}`);
            return false;
        }
    }, [loadGame]);

    const openFile = useCallback(async (file: File) => {
        const system = systemForFile(file.name);
        if (!system) {
            setRomError(`${file.name} is not a ROM of a supported console.`);
            return false;
        }
        return loadGame(system, titleOf(file.name), null, await file.arrayBuffer());
    }, [loadGame]);

    const setRunning = useCallback((run: boolean) => {
        emulationRunning = run;
        setRunningState(run);
        if (run) {
            startAudio(gameRef.current?.emulator);
        } else {
            audio.clear();
        }
    }, []);

    const toggleRun = useCallback(() => setRunning(!emulationRunning), [setRunning]);

    // A game picked by the player starts right away. The pick is a click, so its sound can start too.
    const playRom = useCallback(async (rom: RomEntry) => {
        if (await loadRom(rom)) setRunning(true);
    }, [loadRom, setRunning]);

    const playFile = useCallback(async (file: File) => {
        if (await openFile(file)) setRunning(true);
    }, [openFile, setRunning]);

    const [docsRoute, setDocsOpen] = useDocsRoute();
    const docsOpen = docsRoute !== null;

    // The game waits while the docs are read
    useEffect(() => {
        if (docsOpen) setRunning(false);
    }, [docsOpen, setRunning]);

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

    const toggleDebugger = useCallback(() => {
        setDebuggerShown(shown => {
            storeSetting(DEBUGGER_KEY, String(!shown));
            return !shown;
        });
    }, []);

    const setTouchButtons = useCallback((buttons: number) => {
        input.setTouch(buttons);
        const emulator = gameRef.current?.emulator;
        if (emulator) input.apply(emulator);
    }, []);

    // On touch screens the controls go full screen with the screen, turned to landscape where the
    // browser allows it, which Chrome on Android does in full screen
    const toggleFullscreen = useCallback(() => {
        // iPhones can only show videos full screen, so the way there is adding the page to the Home Screen
        if (!document.fullscreenEnabled) {
            setTip(HOME_SCREEN_TIP);
            return;
        }
        if (document.fullscreenElement) {
            document.exitFullscreen();
            return;
        }
        const touchPlay = touchPlayRef.current;
        (touchPlay ?? screenRef.current)?.requestFullscreen()
            .then(() => {
                const orientation = window.screen.orientation as ScreenOrientation & { lock?: (to: 'landscape') => Promise<void> };
                if (touchPlay) return orientation.lock?.('landscape');
            })
            .catch(e => console.warn('Full screen is not available', e));
    }, []);

    // Escape leaves full screen without going through the button
    useEffect(() => {
        const update = () => setFullscreen(document.fullscreenElement !== null);
        document.addEventListener('fullscreenchange', update);
        return () => document.removeEventListener('fullscreenchange', update);
    }, []);

    useEffect(() => {
        const update = () => setPadNames(playerPads(readPads()).map(padName));
        update();
        window.addEventListener('gamepadconnected', update);
        window.addEventListener('gamepaddisconnected', update);
        return () => {
            window.removeEventListener('gamepadconnected', update);
            window.removeEventListener('gamepaddisconnected', update);
        };
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

    // The page opens with a game playing, unless it opens on the docs
    const docsOpenRef = useRef(docsOpen);
    docsOpenRef.current = docsOpen;
    useEffect(() => {
        loadRom(DEFAULT_ROM).then(loaded => {
            if (loaded && !docsOpenRef.current) setRunning(true);
        });
    }, [loadRom, setRunning]);

    // Its sound starts with the first click or key press
    useEffect(() => {
        const startSound = () => {
            if (emulationRunning && !audio.ready) startAudio(gameRef.current?.emulator);
        };
        const events = ['click', 'keydown', 'touchend'] as const;
        for (const event of events) window.addEventListener(event, startSound, true);
        return () => {
            for (const event of events) window.removeEventListener(event, startSound, true);
        };
    }, []);

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
                input.setKey(0, button, true);
            } else {
                // Always release, the key may have been pressed before focus moved
                input.setKey(0, button, false);
            }
            input.apply(current.emulator);
            event.preventDefault();
            return true;
        }

        // Keys let go of in another window would otherwise stay held
        function releaseKeys() {
            input.releaseKeys();
            const emulator = gameRef.current?.emulator;
            if (emulator) input.apply(emulator);
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
        window.addEventListener('blur', releaseKeys);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleControllerKey);
            window.removeEventListener('blur', releaseKeys);
        };
    }, [drawScreen, toggleMute, toggleRun, stepFrame, resetGame, toggleTheater]);

    useEffect(() => {
        let lastDebugUpdate = 0;
        let startTime: number | null = null;
        let framesDone = 0;
        let requestId = 0;

        function tick(now: number) {
            requestId = requestAnimationFrame(tick);
            const current = gameRef.current;
            // The pads are read with the frames they are used for, the Gamepad API has no events for buttons
            if (current) {
                input.setPads(playerPads(readPads()).map(pad => padButtons(pad, current.system.padMap)));
                input.apply(current.emulator);
            }
            const emulator = current?.emulator;
            if (!emulationRunning || !emulator) {
                startTime = null;
                frameStats.clear();
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
                const start = performance.now();
                emulator.runFrame();
                framesDone++;
                const samples = emulator.takeSamples();
                if (audio.ready) audio.push(samples);
                frameStats.record(now, performance.now() - start);
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

    // Only beside a big screen. On touch screens the same setting shows just the frame time.
    const Debugger = debuggerShown && !touch ? game?.emulator.Debugger : undefined;
    // Touch screens place the screen between the touch controls instead
    const theaterLayout = theater && !touch;
    const screen = game && (
        <div className={theaterLayout ? 'screen theater' : 'screen'} ref={screenRef}>
            <Player
                canvasRef={canvasRef}
                width={game.emulator.width}
                height={game.emulator.height}
                running={running}
                muted={muted}
                volume={volume}
                theater={theater}
                fullscreen={fullscreen}
                fullscreenAvailable={document.fullscreenEnabled || (touch && !isInstalled())}
                touch={touch}
                debuggerShown={debuggerShown}
                onToggleRun={toggleRun}
                onStepFrame={stepFrame}
                onReset={resetGame}
                onToggleMute={toggleMute}
                onVolumeChange={changeVolume}
                onToggleTheater={toggleTheater}
                onToggleFullscreen={toggleFullscreen}
                onToggleDebugger={toggleDebugger}
            />
        </div>
    );
    const playArea = game && touch
        ? <TouchControls ref={touchPlayRef} layout={game.system.touchLayout} onChange={setTouchButtons}>{screen}</TouchControls>
        : screen;
    const frameMs = game ? 1000 / game.emulator.frameRate : 0;
    const help = game && (
        <>
            {!touch && <>
                <code className="instructions">SPACE = Run/Pause    F = Step Frame    R = Reset    M = Mute    T = Theater mode</code>
                <code className="instructions">Controller: {game.system.controlsHelp}</code>
            </>}
            {(!touch || padNames.length > 0) &&
                <code className="instructions">
                    Gamepads: {padNames.length
                        ? padNames.map((name, player) => `${name} = player ${player + 1}`).join('    ')
                        : 'press a button on a gamepad to use it'}
                </code>}
            {!touch && <code className="instructions">Click the screen to run or pause, double-click for full screen</code>}
            {/* To see how fast a device is: the time emulating a frame takes, of the time a frame has */}
            {debuggerShown && running && frameStats.framesPerSecond > 0 &&
                <code className="instructions">
                    {`Frame ${frameStats.averageMs.toFixed(1)} ms of ${frameMs.toFixed(1)} ms (${Math.round(frameStats.averageMs / frameMs * 100)}%), ` +
                        `slowest ${frameStats.slowestMs.toFixed(1)} ms, ${frameStats.framesPerSecond} fps`}
                </code>}
        </>
    );
    // In theater mode the screen goes across the page, above the debugger
    const column = theaterLayout ? help : <>{playArea}{help}</>;

    return (
        <div className={touch ? 'gameArea touch' : 'gameArea'}>
            <header className="header">
                <ConsoleMenu
                    system={game?.system ?? DEFAULT_ROM.system}
                    title={game?.title ?? null}
                    currentUrl={game?.url ?? null}
                    onSelectRom={playRom}
                    onOpenFile={playFile}
                />
                <ProjectInfo onOpenDocs={() => setDocsOpen(true)} />
            </header>
            {docsRoute && <DocsDialog route={docsRoute} onClose={() => setDocsOpen(false)} />}
            {tip && (
                <p className="message tip">
                    {tip}
                    <button className="button" onClick={() => setTip(null)}>OK</button>
                </p>
            )}
            {romError && <p className="message error">{romError}</p>}
            {game?.warning && <p className="message">{game.warning}</p>}
            {game ?
                <>
                    {theaterLayout && screen}
                    <div className="container">
                        {Debugger ? <Debugger>{column}</Debugger> : <div className="column">{column}</div>}
                    </div>
                </>
                : !romError && <p className="message">Loading…</p>}
            <footer className="footer">
                An unofficial project, not affiliated with Nintendo. NES and SNES are trademarks of Nintendo.
            </footer>
        </div>
    );
};

export default App;
