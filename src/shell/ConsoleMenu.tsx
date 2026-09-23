import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { SYSTEMS, type EmulatorSystem } from '../systems';
import { ROM_LIBRARY, type RomEntry } from './romLibrary';

interface ConsoleMenuProps {
    system: EmulatorSystem;
    title: string | null;
    currentUrl: string | null;
    onSelectRom: (rom: RomEntry) => void;
    onOpenFile: (file: File) => void;
}

const ACCEPTED_FILES = SYSTEMS.filter(system => system.create).flatMap(system => system.extensions).join(',');

const ConsoleMenu = ({ system, title, currentUrl, onSelectRom, onOpenFile }: ConsoleMenuProps) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const items = menuItems();
        (items.find(item => item.getAttribute('aria-current') === 'true') ?? items[0])?.focus();

        const closeOnOutsideClick = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        window.addEventListener('pointerdown', closeOnOutsideClick);
        return () => window.removeEventListener('pointerdown', closeOnOutsideClick);
    }, [open]);

    function menuItems(): HTMLElement[] {
        return Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    }

    // Gives the keyboard back to the emulator
    function close() {
        setOpen(false);
        triggerRef.current?.blur();
    }

    function handleMenuKey(event: KeyboardEvent) {
        const items = menuItems();
        const index = items.indexOf(document.activeElement as HTMLElement);
        switch (event.key) {
            case 'Escape':
                setOpen(false);
                triggerRef.current?.focus();
                break;
            case 'ArrowDown':
                items[(index + 1) % items.length]?.focus();
                break;
            case 'ArrowUp':
                items[(index - 1 + items.length) % items.length]?.focus();
                break;
            case 'Home':
                items[0]?.focus();
                break;
            case 'End':
                items[items.length - 1]?.focus();
                break;
            case 'Tab':
                setOpen(false);
                return;
            default:
                return;
        }
        event.preventDefault();
    }

    function selectRom(rom: RomEntry) {
        close();
        onSelectRom(rom);
    }

    function handleFileChosen(event: ChangeEvent<HTMLInputElement>) {
        const input = event.currentTarget;
        const file = input.files?.[0];
        // Allows choosing the same file again
        input.value = '';
        close();
        if (file) onOpenFile(file);
    }

    return (
        <div className="consoleMenu" ref={rootRef}>
            <button
                ref={triggerRef}
                className="consoleMenu-trigger"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
            >
                <system.Logo className="consoleLogo" />
                <span className="consoleMenu-label">
                    <span className="consoleMenu-system">{system.shortName}</span>
                    <span className="consoleMenu-title">{title ?? 'No game'}</span>
                </span>
                <svg className="consoleMenu-caret" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
            {open && (
                <div className="consoleMenu-list" role="menu" ref={menuRef} onKeyDown={handleMenuKey}>
                    {SYSTEMS.map(entry => {
                        const games = ROM_LIBRARY.filter(rom => rom.system === entry);
                        const available = entry.create !== undefined;
                        return (
                            <div key={entry.id} className="consoleMenu-group" role="group" aria-label={entry.name}>
                                <div className="consoleMenu-heading">
                                    <entry.Logo className="consoleLogo small" />
                                    <span>{entry.name}</span>
                                    {!available && <span className="badge">Coming soon</span>}
                                </div>
                                {games.map(rom => (
                                    <button
                                        key={rom.url}
                                        role="menuitem"
                                        className="consoleMenu-item"
                                        aria-current={rom.url === currentUrl}
                                        disabled={!available}
                                        onClick={() => selectRom(rom)}
                                    >
                                        {rom.title}
                                    </button>
                                ))}
                                {available && games.length === 0 && (
                                    <p className="consoleMenu-empty">Put {entry.extensions.join(' / ')} files in public/roms to list them here.</p>
                                )}
                            </div>
                        );
                    })}
                    <div className="consoleMenu-group">
                        <button role="menuitem" className="consoleMenu-item" onClick={() => fileRef.current?.click()}>
                            Open ROM file…
                        </button>
                        <input ref={fileRef} type="file" accept={ACCEPTED_FILES} onChange={handleFileChosen} hidden />
                    </div>
                </div>
            )}
        </div>
    );
};

export default ConsoleMenu;
