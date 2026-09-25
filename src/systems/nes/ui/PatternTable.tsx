import { useEffect, useRef } from 'react';
import type { IndexedImage } from '../core/graphics';

const PatternTable = ({ patternTable }: { patternTable: IndexedImage }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // The image is updated in place, so redraw on every render
    useEffect(() => {
        const context = canvasRef.current?.getContext('2d');
        if (!context) return;
        const image = context.createImageData(patternTable.width, patternTable.height);
        patternTable.toRgba(image.data);
        context.putImageData(image, 0, 0);
    });

    return (
        <canvas id="patternCanvas" ref={canvasRef} width={patternTable.width} height={patternTable.height} />
    );
};

export default PatternTable;
