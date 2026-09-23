import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Emulator, EmulatorSystem } from '../systems';
import { systemForFile } from '../systems';
import AudioOutput from './audio/audioOutput';
import ConsoleMenu from './ConsoleMenu';
import { DEFAULT_ROM, type RomEntry } from './romLibrary';

const DEBUG_REFRESH_MS = 100;
const MAX_FRAMES_PER_TICK = 4;

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

function titleOf(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.slice(0, dot) : fileName;
}

const App = () => {
    const [game, setGame] = useState<Game | null>(null);
    const [romError, setRomError] = useState<string | null>(null);
    const [muted, setMuted] = useState(false);
    // Re-renders the debugger, which reads the emulator state directly
    const [, refreshDebugger] = useReducer((n: number) => n + 1, 0);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<ImageData | null>(null);
    const gameRef = useRef<Game | null>(null);
    gameRef.current = game;

    const drawScreen = useCallback(() => {
        const emulator = gameRef.current?.emulator;
        const context = canvasRef.current?.getContext('2d');
        if (!emulator || !context) return;

        let frame = frameRef.current;
        if (frame?.width !== emulator.width || frame.height !== emulator.height) {
            frame = frameRef.current = context.createImageData(emulator.width, emulator.height);
        }
        emulator.drawFrame(frame);
        context.putImageData(frame, 0, 0);
    }, []);

    const loadGame = useCallback((system: EmulatorSystem, title: string, url: string | null, data: ArrayBuffer) => {
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
        if (audio.sampleRate) emulator.setSampleRate(audio.sampleRate);
        audio.clear();
        setGame({ system, emulator, title, url, warning });
        setRomError(null);
    }, []);

    const loadRom = useCallback(async (rom: RomEntry) => {
        try {
            const response = await fetch(rom.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            loadGame(rom.system, rom.title, rom.url, await response.arrayBuffer());
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
        loadGame(system, titleOf(file.name), null, await file.arrayBuffer());
    }, [loadGame]);

    const toggleMute = useCallback(() => {
        const mute = !audio.isMuted;
        audio.setMuted(mute);
        setMuted(mute);
        startAudio(gameRef.current?.emulator);
    }, []);

    useEffect(() => {
        loadRom(DEFAULT_ROM);
    }, [loadRom]);

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

            if (emulator?.handleDebugKey?.(event.code)) {
                drawScreen();
                refreshDebugger();
                return;
            }

            switch (event.code) {
                case 'Space':
                    event.preventDefault();
                    bEmulationRun = !bEmulationRun;
                    if (bEmulationRun) {
                        startAudio(emulator);
                    } else {
                        audio.clear();
                    }
                    break;
                case 'KeyF':
                    emulator?.runFrame();
                    drawScreen();
                    break;
                case 'KeyM':
                    toggleMute();
                    break;
                case 'KeyR':
                    emulator?.reset();
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
    }, [drawScreen, toggleMute]);

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
        <>
            <canvas id="emulationCanvas" ref={canvasRef} width={game.emulator.width} height={game.emulator.height} />
            <code className="instructions">SPACE = Run/Pause    F = Step Frame    R = Reset    M = Mute</code>
            <code className="instructions">Controller: {game.system.controlsHelp}</code>
        </>
    );

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
                <button className="button" onClick={event => { toggleMute(); event.currentTarget.blur(); }}>
                    Sound: {muted ? 'Off' : 'On'}
                </button>
            </header>
            {romError && <p className="message error">{romError}</p>}
            {game?.warning && <p className="message">{game.warning}</p>}
            {game ?
                <div className="container">
                    {Debugger ? <Debugger>{screen}</Debugger> : <div className="column">{screen}</div>}
                </div>
                : !romError && <p className="message">Loading…</p>}
        </div>
    );
};

export default App;
