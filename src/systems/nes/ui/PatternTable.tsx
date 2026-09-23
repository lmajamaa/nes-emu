import { useEffect, useRef } from 'react';
import type { Sprite } from '../../../nes/graphics';

const PatternTable = ({ patternTable }: { patternTable: Sprite }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;

        const canvasData = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let x = 0; x < patternTable.width; x++) {
            for (let y = 0; y < patternTable.height; y++) {
                const pixel = patternTable.getPixel(x, y);
                const index = (x * 4 + (y * patternTable.width) * 4);
                canvasData.data[index + 0] = pixel.r;
                canvasData.data[index + 1] = pixel.g;
                canvasData.data[index + 2] = pixel.b;
                canvasData.data[index + 3] = 255;
            }
        }
        context.putImageData(canvasData, 0, 0);
    }); // The sprite is updated in place, so redraw on every render

    return (
        <canvas id="patternCanvas" ref={canvasRef} width={patternTable.width} height={patternTable.height} />
    );
}

export default PatternTable;
