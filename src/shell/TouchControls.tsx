import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type Ref } from 'react';
import type { TouchButton, TouchLayout } from '../systems/types';
import { dpadButtons } from './touch';

const COARSE_POINTER = '(pointer: coarse)';

// Whether the main pointer is a finger, so the screen needs touch controls
export function useTouchScreen(): boolean {
    const [touch, setTouch] = useState(() => matchMedia(COARSE_POINTER).matches);
    useEffect(() => {
        const query = matchMedia(COARSE_POINTER);
        const update = () => setTouch(query.matches);
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);
    return touch;
}

interface TouchControlsProps {
    layout: TouchLayout;
    // The buttons held, whenever they change
    onChange: (buttons: number) => void;
    // The screen, which the controls go around
    children: ReactNode;
    // What goes full screen on touch screens, so the controls come along
    ref?: Ref<HTMLDivElement>;
}

// A D-pad under the left thumb and the console's buttons under the right one. Each finger presses
// what it is over, and keeps pressing as it slides, like rolling a thumb from B to A.
const TouchControls = ({ layout, onChange, children, ref }: TouchControlsProps) => {
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const [held, setHeld] = useState(0);
    const heldRef = useRef(0);

    // Let go of everything when the controls go away, e.g. when a keyboard is attached
    useEffect(() => () => onChange(0), [onChange]);

    function buttonsAt(x: number, y: number): number {
        for (const element of document.elementsFromPoint(x, y)) {
            if (!(element instanceof HTMLElement)) continue;
            if (element.dataset.dpad !== undefined) {
                const rect = element.getBoundingClientRect();
                return dpadButtons(x - rect.left - rect.width / 2, y - rect.top - rect.height / 2, rect.width / 2, layout.dpad);
            }
            if (element.dataset.button !== undefined) return Number(element.dataset.button);
        }
        return 0;
    }

    function update() {
        let buttons = 0;
        for (const { x, y } of pointers.current.values()) buttons |= buttonsAt(x, y);
        if (buttons === heldRef.current) return;
        heldRef.current = buttons;
        setHeld(buttons);
        onChange(buttons);
    }

    const down = (event: PointerEvent<HTMLDivElement>) => {
        // Only fingers that start on the controls, the screen keeps its own buttons
        if (!(event.target instanceof Element) || !event.target.closest('.touchCluster')) return;
        event.preventDefault();
        // Keeps the moves coming when a finger leaves the controls. Touches are captured anyway, so a
        // pointer that can't be captured still counts.
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Pressed all the same
        }
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        update();
    };
    const move = (event: PointerEvent<HTMLDivElement>) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        update();
    };
    const up = (event: PointerEvent<HTMLDivElement>) => {
        if (pointers.current.delete(event.pointerId)) update();
    };

    const pressed = (button: number) => (held & button) === button && button !== 0;
    const touchButton = ({ label, button }: TouchButton, className: string) => (
        <div key={label} className={`${className}${pressed(button) ? ' pressed' : ''}`} data-button={button}>{label}</div>
    );
    const arm = (direction: keyof TouchLayout['dpad']) => (
        <div className={`touchDpad-arm ${direction}${pressed(layout.dpad[direction]) ? ' pressed' : ''}`} />
    );
    const [left, right] = layout.shoulders;
    const [select, start] = layout.menu;

    return (
        <div
            ref={ref}
            className="touchPlay"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onContextMenu={event => event.preventDefault()}
        >
            <div className="touchCluster left" aria-hidden="true">
                <div className="touchShoulder">{left && touchButton(left, 'touchButton shoulder')}</div>
                <div className="touchDpad" data-dpad="">
                    {arm('up')}{arm('left')}{arm('right')}{arm('down')}
                    <div className="touchDpad-middle" />
                </div>
                {touchButton(select, 'touchButton menu')}
            </div>
            <div className="touchScreen">{children}</div>
            <div className="touchCluster right" aria-hidden="true">
                <div className="touchShoulder">{right && touchButton(right, 'touchButton shoulder')}</div>
                <div className={`touchFace buttons${layout.face.length}`}>
                    {layout.face.map(face => touchButton(face, `touchButton face ${face.position}`))}
                </div>
                {touchButton(start, 'touchButton menu')}
            </div>
        </div>
    );
};

export default TouchControls;
