export function hex(number: number, length: number): string {
    return number.toString(16).toUpperCase().padStart(length, '0');
}

export function binary(number: number, length: number): string {
    return number.toString(2).padStart(length, '0');
}

export function convertUint8ToInt(value: number): number {
    return value & 0x80 ? value - 256 : value;
}
