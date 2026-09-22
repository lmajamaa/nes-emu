import { hex } from '../utils';
import type { CpuState } from '../nes/cpu';

const Cpu = ({ cpu }: { cpu: CpuState }) => (
    <div className="cpuArea">
        <h4>
            Status:
            <span className={cpu.n === 1 ? 'active' : 'inActive'}>N</span>
            <span className={cpu.v === 1 ? 'active' : 'inActive'}>V</span>
            <span className={cpu.u === 1 ? 'active' : 'inActive'}>-</span>
            <span className={cpu.b === 1 ? 'active' : 'inActive'}>B</span>
            <span className={cpu.d === 1 ? 'active' : 'inActive'}>D</span>
            <span className={cpu.i === 1 ? 'active' : 'inActive'}>I</span>
            <span className={cpu.z === 1 ? 'active' : 'inActive'}>Z</span>
            <span className={cpu.c === 1 ? 'active' : 'inActive'}>C</span>
        </h4>
        <code>
            {`PC: $${hex(cpu.pc, 4)} A: $${hex(cpu.a, 2)} [${cpu.a}] X: $${hex(cpu.x, 2)} [${cpu.x}] Y: $${hex(cpu.y, 2)} [${cpu.y}] Stack P: $${hex(cpu.stkp, 4)}`}
        </code>
    </div>
);

export default Cpu;
