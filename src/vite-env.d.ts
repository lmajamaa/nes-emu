declare module 'virtual:rom-library' {
    // File names in public/roms
    const romFiles: string[];
    export default romFiles;
}

declare module 'virtual:docs' {
    const docs: import('../plugins/docs').Doc[];
    export default docs;
}
