import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';

// Controls hide this long after the mouse stops, while running
const IDLE_MS = 2500;

interface PlayerProps {
    canvasRef: RefObject<HTMLCanvasElement | null>;
    width: number;
    height: number;
    running: boolean;
    muted: boolean;
    // 0 to 1
    volume: number;
    theater: boolean;
    fullscreen: boolean;
    // Whether the full screen button does something, going full screen or explaining the alternative
    fullscreenAvailable: boolean;
    // On touch screens a tap on the screen doesn't pause, and the controls stay shown
    touch: boolean;
    debuggerShown: boolean;
    onToggleRun: () => void;
    onStepFrame: () => void;
    onReset: () => void;
    onToggleMute: () => void;
    onVolumeChange: (volume: number) => void;
    onToggleTheater: () => void;
    onToggleFullscreen: () => void;
    onToggleDebugger: () => void;
}

const Icon = ({ children }: { children: ReactNode }) => (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor">{children}</svg>
);

const ICONS = {
    play: <Icon><path d="M8 5v14l11-7z" /></Icon>,
    pause: <Icon><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></Icon>,
    step: <Icon><path d="M6 6l8.5 6L6 18zM16 6h2v12h-2z" /></Icon>,
    reset: <Icon><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" /></Icon>,
    sound: <Icon><path d="M4 9v6h4l5 5V4L8 9zM15.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" /></Icon>,
    soundLow: <Icon><path d="M4 9v6h4l5 5V4L8 9zM15.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" /></Icon>,
    muted: <Icon><path d="M4 9v6h4l5 5V4L8 9zM16.6 12l2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z" /></Icon>,
    frameTime: <Icon><path d="M20.4 8.6l-1.2 1.8a8 8 0 0 1-.3 7.6H5.1A8 8 0 0 1 15.6 6.9l1.8-1.2A10 10 0 0 0 3.4 19a2 2 0 0 0 1.7 1h13.8a2 2 0 0 0 1.8-1 10 10 0 0 0-.3-10.4zm-9.8 6.8a2 2 0 0 0 2.8 0l5.7-8.5-8.5 5.7a2 2 0 0 0 0 2.8z" /></Icon>,
    theater: <Icon><path d="M3 7h18v10H3zm2 2v6h14V9z" /></Icon>,
    theaterOff: <Icon><path d="M6 8h12v8H6zm2 2v4h8v-4z" /></Icon>,
    fullscreen: <Icon><path d="M4 4h6v2H6v4H4zM14 4h6v6h-2V6h-4zM4 14h2v4h4v2H4zM18 14h2v6h-6v-2h4z" /></Icon>,
    fullscreenOff: <Icon><path d="M8 4h2v6H4V8h4zM14 4h2v4h4v2h-6zM4 14h6v6H8v-4H4zM14 14h6v2h-4v4h-2z" /></Icon>,
    debugger: <Icon><path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6z" /></Icon>,
};

// The game's screen, with controls over its bottom edge like a video player's
const Player = (props: PlayerProps) => {
    const { canvasRef, width, height, running, muted, volume, theater, fullscreen, touch, debuggerShown } = props;
    const [active, setActive] = useState(true);
    const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const wake = () => {
        setActive(true);
        clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => setActive(false), IDLE_MS);
    };

    useEffect(() => () => clearTimeout(idleTimer.current), []);

    // Starting to run counts as activity too, so the controls hide even without the mouse moving
    useEffect(() => {
        if (running) wake();
    }, [running]);

    // A button's click shouldn't also reach the screen, and gives the keyboard back to the emulator
    const button = (label: string, icon: ReactNode, action: () => void) => (
        <button
            className="controlButton"
            aria-label={label}
            title={label}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                action();
                event.currentTarget.blur();
            }}
            onDoubleClick={event => event.stopPropagation()}
        >
            {icon}
        </button>
    );

    const idle = running && !active && !touch;
    const silent = muted || volume === 0;
    return (
        <div
            className={idle ? 'player idle' : 'player'}
            onMouseMove={touch ? undefined : wake}
            onMouseLeave={touch ? undefined : () => setActive(false)}
            onClick={touch ? undefined : props.onToggleRun}
            onDoubleClick={touch ? undefined : props.onToggleFullscreen}
        >
            <canvas id="emulationCanvas" ref={canvasRef} width={width} height={height} />
            <div className={running && !touch ? 'controls' : 'controls paused'}>
                {button(running ? 'Pause (Space)' : 'Run (Space)', running ? ICONS.pause : ICONS.play, props.onToggleRun)}
                {button('Step one frame (F)', ICONS.step, props.onStepFrame)}
                {button('Reset (R)', ICONS.reset, props.onReset)}
                <div className="volume">
                    {button(silent ? 'Unmute (M)' : 'Mute (M)', silent ? ICONS.muted : volume < 0.5 ? ICONS.soundLow : ICONS.sound,
                        // At zero, unmuting would stay silent, so it turns the volume up instead
                        volume === 0 ? () => props.onVolumeChange(0.5) : props.onToggleMute)}
                    {/* Pops up above the sound button, while hovering it or tabbed to */}
                    <div className="volumePopup">
                        <input
                            className="volumeSlider"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={silent ? 0 : volume}
                            aria-label="Volume"
                            aria-orientation="vertical"
                            title="Volume"
                            onChange={event => props.onVolumeChange(Number(event.currentTarget.value))}
                            onClick={event => event.stopPropagation()}
                            onDoubleClick={event => event.stopPropagation()}
                            // The arrow keys belong to the controller once the slider is let go
                            onPointerUp={event => event.currentTarget.blur()}
                        />
                    </div>
                </div>
                <span className="controlsSpacer" />
                {/* Touch screens have no room for the debugger, only for how long frames take */}
                {touch
                    ? button(debuggerShown ? 'Hide the frame time' : 'Show the frame time', ICONS.frameTime, props.onToggleDebugger)
                    : button(debuggerShown ? 'Hide the debugger' : 'Show the debugger', ICONS.debugger, props.onToggleDebugger)}
                {!touch && button(theater ? 'Default view (T)' : 'Theater mode (T)', theater ? ICONS.theaterOff : ICONS.theater, props.onToggleTheater)}
                {props.fullscreenAvailable &&
                    button(fullscreen ? 'Exit full screen' : 'Full screen', fullscreen ? ICONS.fullscreenOff : ICONS.fullscreen, props.onToggleFullscreen)}
            </div>
        </div>
    );
};

export default Player;
