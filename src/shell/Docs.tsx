import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import docs from 'virtual:docs';

// The docs have their own address, like #/docs/docs/nes.md#progress, so links and Back work
const PREFIX = '#/docs/';

export interface DocsRoute {
    path: string;
    anchor: string;
}

function routeOf(hash: string): DocsRoute | null {
    if (!hash.startsWith(PREFIX)) return null;
    const [path = '', anchor = ''] = decodeURIComponent(hash.slice(PREFIX.length)).split('#', 2);
    return docs.some(doc => doc.path === path) ? { path, anchor } : { path: docs[0]!.path, anchor: '' };
}

// The open doc, or null when the docs are closed
export function useDocsRoute(): [DocsRoute | null, (open: boolean) => void] {
    const [route, setRoute] = useState(() => routeOf(location.hash));

    useEffect(() => {
        const update = () => setRoute(routeOf(location.hash));
        window.addEventListener('hashchange', update);
        return () => window.removeEventListener('hashchange', update);
    }, []);

    const setOpen = useCallback((open: boolean) => {
        if (open) {
            if (!routeOf(location.hash)) location.hash = PREFIX + docs[0]!.path;
        } else {
            history.pushState(null, '', location.pathname + location.search);
            setRoute(null);
        }
    }, []);

    return [route, setOpen];
}

const CloseIcon = () => (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
        <path d="M6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z" />
    </svg>
);

export const DocsIcon = () => (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5zM7 12v2h10v-2zm0 4v2h7v-2z" />
    </svg>
);

// The project's markdown docs, rendered at build time, over the page
export const DocsDialog = ({ route, onClose }: { route: DocsRoute; onClose: () => void }) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const articleRef = useRef<HTMLElement>(null);
    const doc = docs.find(entry => entry.path === route.path) ?? docs[0]!;

    useEffect(() => {
        const dialog = dialogRef.current;
        dialog?.showModal();
        return () => dialog?.close();
    }, []);

    // To the heading linked to, or the top of a newly opened doc
    useEffect(() => {
        const article = articleRef.current;
        if (!article) return;
        const heading = route.anchor ? article.querySelector(`#${CSS.escape(route.anchor)}`) : null;
        if (heading) heading.scrollIntoView();
        else article.scrollTop = 0;
    }, [route.path, route.anchor]);

    // Clicks on the backdrop land on the dialog itself
    const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
        if (event.target === event.currentTarget) onClose();
    };

    return (
        <dialog
            ref={dialogRef}
            className="docs"
            aria-labelledby="docsTitle"
            onCancel={event => {
                event.preventDefault();
                onClose();
            }}
            onClick={closeOnBackdrop}
        >
            <header className="docs-header">
                <h2 id="docsTitle">Documentation</h2>
                <button className="docs-close" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose}>
                    <CloseIcon />
                </button>
            </header>
            <div className="docs-body">
                <nav className="docs-nav" aria-label="Documents">
                    {docs.map(entry => (
                        <a key={entry.path} href={PREFIX + entry.path} aria-current={entry.path === doc.path ? 'page' : undefined}>
                            <span className="docs-navTitle">{entry.title}</span>
                            <span className="docs-navPath">{entry.path}</span>
                        </a>
                    ))}
                </nav>
                <article ref={articleRef} className="docs-content" dangerouslySetInnerHTML={{ __html: doc.html }} />
            </div>
        </dialog>
    );
};
