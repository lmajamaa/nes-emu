import { hex } from '../../../utils';
import type Bus from '../../../nes/bus';

interface RamProps {
    bus: Bus;
    start: number;
    rows: number;
    columns: number;
}

const Ram = ({ bus, start, rows, columns }: RamProps) => (
    <div className="ramArea">
        {Array.from({ length: rows }, (_, row) => {
            const address = start + row * columns;
            const bytes = Array.from({ length: columns }, (_, column) => hex(bus.cpuRead(address + column, true), 2));
            return <code key={row}>{`$${hex(address, 4)}: ${bytes.join(' ')} `}</code>;
        })}
    </div>
);

export default Ram;
