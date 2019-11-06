export function hex(number, length) {
    if(number !== undefined) {
        return number.toString(16).toUpperCase().padStart(length, 0x00);
    } else {
        return undefined;
    }
}
export function binary(number, length) {
    return number.toString(2).padStart(length, 0);
}

export function convertUint8ToInt(value) {
    return value & 0x07 ? value - 256 : value;
}