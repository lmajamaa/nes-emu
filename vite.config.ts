import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const ROM_LIBRARY_ID = 'virtual:rom-library';
const RESOLVED_ROM_LIBRARY_ID = '\0' + ROM_LIBRARY_ID;

// Lists the ROMs in public/roms, so they can be picked from the menu
function romLibrary(): Plugin {
    let romDir = '';
    return {
        name: 'rom-library',
        configResolved(config) {
            romDir = normalizePath(join(config.publicDir, 'roms'));
        },
        resolveId(id) {
            return id === ROM_LIBRARY_ID ? RESOLVED_ROM_LIBRARY_ID : undefined;
        },
        load(id) {
            if (id !== RESOLVED_ROM_LIBRARY_ID) return;
            const files = existsSync(romDir)
                ? readdirSync(romDir, { withFileTypes: true }).filter(file => file.isFile()).map(file => file.name)
                : [];
            return `export default ${JSON.stringify(files)};`;
        },
        configureServer(server) {
            server.watcher.add(romDir);
            const onChange = (file: string) => {
                if (normalizePath(dirname(file)) !== romDir) return;
                const graph = server.environments.client.moduleGraph;
                const module = graph.getModuleById(RESOLVED_ROM_LIBRARY_ID);
                if (module) graph.invalidateModule(module);
                server.ws.send({ type: 'full-reload' });
            };
            server.watcher.on('add', onChange);
            server.watcher.on('unlink', onChange);
        },
    };
}

export default defineConfig({
    plugins: [react(), romLibrary()],
    server: {
        port: 3000,
    },
    build: {
        outDir: 'build',
    },
});
