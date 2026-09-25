export function hex(number: number, length: number): string {
    return number.toString(16).toUpperCase().padStart(length, '0');
}

export function binary(number: number, length: number): string {
    return number.toString(2).padStart(length, '0');
}

export function convertUint8ToInt(value: number): number {
    return value & 0x80 ? value - 256 : value;
}

// FNV-1a, to tell games apart for their saves
export function hashOf(data: Uint8Array): string {
    let hash = 0x811C9DC5;
    for (let i = 0; i < data.length; i++) {
        hash ^= data[i];
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
