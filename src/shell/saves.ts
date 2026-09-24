// Keeps games' battery-backed save RAM in IndexedDB, by the id the emulator gives the game

const DATABASE = 'nes-emu';
const STORE = 'saves';

let database: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
    database ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return database;
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return open().then(db => new Promise((resolve, reject) => {
        const result = run(db.transaction(STORE, mode).objectStore(STORE));
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
    }));
}

export async function readSave(id: string): Promise<Uint8Array | null> {
    try {
        const data = await request<unknown>('readonly', store => store.get(id));
        return data instanceof Uint8Array ? data : null;
    } catch (e) {
        console.warn('Could not read the save', e);
        return null;
    }
}

export async function writeSave(id: string, data: Uint8Array): Promise<void> {
    try {
        await request('readwrite', store => store.put(data, id));
    } catch (e) {
        console.warn('Could not store the save', e);
    }
}
