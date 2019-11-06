import React, { useEffect, useRef } from 'react';

const PatternTable = ({ patternTable }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        var canvasData = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let x = 0; x < patternTable.width; x++) {
            for (let y = 0; y < patternTable.height; y++) {
                let pixel = patternTable.getPixel(x, y);
                let index = (x * 4 + (y * patternTable.width) * 4);
                canvasData.data[index + 0] = pixel.r;
                canvasData.data[index + 1] = pixel.g;
                canvasData.data[index + 2] = pixel.b;
                canvasData.data[index + 3] = 255;
            }
        }
        context.putImageData(canvasData, 0, 0);
    }, [patternTable]); // This effect never re-runs

    return (
        <canvas id="patternCanvas" ref={canvasRef} width={patternTable.width} height={patternTable.height} />
    );
}

export default PatternTable;
