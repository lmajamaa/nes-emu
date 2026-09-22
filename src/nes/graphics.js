export class Pixel {
    constructor(r, g, b) {
        this.r = r;
        this.g = g;
        this.b = b;
    }
}

export class Sprite {
    constructor(width, height) {
        this.width = width;
        this.height = height;

        // Every column needs its own array, fill() would share a single one
        const black = new Pixel(0, 0, 0);
        this.content = Array.from({ length: width + 1 }, () => Array(height + 1).fill(black));
    }

    getPixel(x, y) {
        return this.content[x][y];
    }

    setPixel(x, y, pixel) {
        if (x >= 0 && y >= 0 && x <= this.width && y <= this.height) {
            this.content[x][y] = pixel;
        }
    }
}

export const palScreen = [
    new Pixel(84, 84, 84),
    new Pixel(0, 30, 116),
    new Pixel(8, 16, 144),
    new Pixel(48, 0, 136),
    new Pixel(68, 0, 100),
    new Pixel(92, 0, 48),
    new Pixel(84, 4, 0),
    new Pixel(60, 24, 0),
    new Pixel(32, 42, 0),
    new Pixel(8, 58, 0),
    new Pixel(0, 64, 0),
    new Pixel(0, 60, 0),
    new Pixel(0, 50, 60),
    new Pixel(0, 0, 0),
    new Pixel(0, 0, 0),
    new Pixel(0, 0, 0),

    new Pixel(152, 150, 152),
    new Pixel(8, 76, 196),
    new Pixel(48, 50, 236),
    new Pixel(92, 30, 228),
    new Pixel(136, 20, 176),
    new Pixel(160, 20, 100),
    new Pixel(152, 34, 32),
    new Pixel(120, 60, 0),
    new Pixel(84, 90, 0),
    new Pixel(40, 114, 0),
    new Pixel(8, 124, 0),
    new Pixel(0, 118, 40),
    new Pixel(0, 102, 120),
    new Pixel(0, 0, 0),
    new Pixel(0, 0, 0),
    new Pixel(0, 0, 0),

    new Pixel(236, 238, 236),
    new Pixel(76, 154, 236),
    new Pixel(120, 124, 236),
    new Pixel(176, 98, 236),
    new Pixel(228, 84, 236),
    new Pixel(236, 88, 180),
    new Pixel(236, 106, 100),
    new Pixel(212, 136, 32),
    new Pixel(160, 170, 0),
    new Pixel(116, 196, 0),
    new Pixel(76, 208, 32),
    new Pixel(56, 204, 108),
    new Pixel(56, 180, 204),
    new Pixel(60, 60, 60),
    new Pixel(0, 0, 0),
    new Pixel(0, 0, 0),

    new Pixel(236, 238, 236),
    new Pixel(168, 204, 236),
    new Pixel(188, 188, 236),
    new Pixel(212, 178, 236),
    new Pixel(236, 174, 236),
    new Pixel(236, 174, 212),
    new Pixel(236, 180, 176),
    new Pixel(228, 196, 144),
    new Pixel(204, 210, 120),
    new Pixel(180, 222, 120),
    new Pixel(168, 226, 144),
    new Pixel(152, 226, 180),
    new Pixel(160, 214, 228),
    new Pixel(160, 162, 160),
    new Pixel(0, 0, 0),
    new Pixel(0, 0, 0)
];