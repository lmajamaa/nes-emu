import { describe, expect, test } from 'bun:test';
import Resampler from './resampler';

describe('SNES resampler', () => {
    const stereo = (values: number[]) => Int16Array.from(values.flatMap(v => [v, v]));

    test('keeps the channels apart, scaled to -1 to 1', () => {
        const resampler = new Resampler(1000);
        resampler.setOutputRate(1000);
        const output = resampler.resample(Int16Array.from([16384, 0, -32768, 8192, 0, 0]));
        expect(Array.from(output)).toEqual([0.5, 0, -1, 0.25]);
    });

    test('interpolates between samples when upsampling', () => {
        const resampler = new Resampler(1000);
        resampler.setOutputRate(2000);
        const output = resampler.resample(Int16Array.from([0, 0, 16384, -16384, 0, 0]));
        expect(Array.from(output)).toEqual([0, 0, 0.25, -0.25, 0.5, -0.5, 0.25, -0.25]);
    });

    test('keeps its position across blocks', () => {
        const once = new Resampler(32000);
        once.setOutputRate(48000);
        const whole = once.resample(stereo(Array.from({ length: 64 }, (_, i) => i * 100)));

        const split = new Resampler(32000);
        split.setOutputRate(48000);
        const values = Array.from({ length: 64 }, (_, i) => i * 100);
        const parts = [split.resample(stereo(values.slice(0, 23))), split.resample(stereo(values.slice(23)))];
        const joined = [...parts[0], ...parts[1]];
        expect(joined.length).toBe(whole.length);
        joined.forEach((value, i) => expect(value).toBeCloseTo(whole[i], 6));
    });
});
