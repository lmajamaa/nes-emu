import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { normalizePath, type Plugin } from 'vite';

const DOCS_ID = 'virtual:docs';
const RESOLVED_DOCS_ID = '\0' + DOCS_ID;

export interface Doc {
    // From the repository root, like docs/nes.md
    path: string;
    title: string;
    html: string;
}

// The markdown files in the docs folder
export function findDocs(root: string): string[] {
    const docsDir = join(root, 'docs');
    if (!existsSync(docsDir)) return [];
    return readdirSync(docsDir).filter(file => file.endsWith('.md')).sort().map(file => `docs/${file}`);
}

// Where the app shows a doc, and a heading in it
export function docHref(path: string, anchor = ''): string {
    return `#/docs/${path}${anchor ? `#${anchor}` : ''}`;
}

function titleOf(markdown: string, path: string): string {
    const heading = /^# (.+)$/m.exec(markdown)?.[1];
    return heading ? heading.replace(/[`*_]/g, '') : path;
}

function isExternal(url: string): boolean {
    return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}

// Links to the other docs stay in the app, links to other files in the repository go to GitHub
function rewriteLinks(html: string, path: string, docPaths: ReadonlySet<string>, repoUrl: string): string {
    const resolveLink = (url: string) => {
        const [file, anchor = ''] = url.split('#', 2);
        const target = file ? posix.normalize(posix.join(posix.dirname(path), file)) : path;
        return { target, anchor };
    };
    const openInNewTab = (element: HTMLRewriterTypes.Element) => {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noreferrer');
    };
    return new HTMLRewriter()
        .on('a[href]', {
            element(element) {
                const href = element.getAttribute('href')!;
                if (isExternal(href)) {
                    openInNewTab(element);
                    return;
                }
                const { target, anchor } = resolveLink(href);
                if (docPaths.has(target)) {
                    element.setAttribute('href', docHref(target, anchor));
                } else {
                    element.setAttribute('href', `${repoUrl}/blob/main/${target}${anchor ? `#${anchor}` : ''}`);
                    openInNewTab(element);
                }
            },
        })
        .on('img[src]', {
            element(element) {
                const src = element.getAttribute('src')!;
                if (!isExternal(src)) element.setAttribute('src', `${repoUrl}/raw/main/${resolveLink(src).target}`);
            },
        })
        .transform(html);
}

export function renderDoc(markdown: string, path: string, docPaths: ReadonlySet<string>, repoUrl: string): Doc {
    // Heading ids like GitHub's, so links to them work the same in both
    const html = Bun.markdown.html(markdown, { headings: { ids: true } });
    return { path, title: titleOf(markdown, path), html: rewriteLinks(html, path, docPaths, repoUrl) };
}

export function renderDocs(root: string): Doc[] {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const repoUrl = String(pkg.repository?.url ?? pkg.repository ?? '').replace(/\.git$/, '');
    const paths = findDocs(root);
    const docPaths = new Set(paths);
    return paths.map(path => renderDoc(readFileSync(join(root, path), 'utf8'), path, docPaths, repoUrl));
}

// The docs folder rendered to HTML, to read it in the app
export function docsPlugin(): Plugin {
    let root = '';
    return {
        name: 'docs',
        configResolved(config) {
            if (typeof Bun === 'undefined') {
                throw new Error('The docs are rendered with Bun.markdown, run Vite with bun --bun vite');
            }
            root = config.root;
        },
        resolveId(id) {
            return id === DOCS_ID ? RESOLVED_DOCS_ID : undefined;
        },
        load(id) {
            if (id !== RESOLVED_DOCS_ID) return;
            return `export default ${JSON.stringify(renderDocs(root))};`;
        },
        configureServer(server) {
            const isDoc = (file: string) => /^docs\/[^/]+\.md$/.test(normalizePath(relative(root, file)));
            server.watcher.on('all', (_event, file) => {
                if (!isDoc(file)) return;
                const graph = server.environments.client.moduleGraph;
                const module = graph.getModuleById(RESOLVED_DOCS_ID);
                if (module) graph.invalidateModule(module);
                server.ws.send({ type: 'full-reload' });
            });
        },
    };
}
