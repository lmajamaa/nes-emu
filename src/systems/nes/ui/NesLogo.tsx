import type { SVGProps } from 'react';

const NesLogo = (props: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 64 40" role="img" aria-label="NES" {...props}>
        <path d="M7 5h50l5 9H2z" fill="#DAD7D0" />
        <path d="M15 7h26l2 5H13z" fill="#55555A" />
        <path d="M17 8.5h22M16.5 10.5h23" stroke="#3A3A3F" strokeWidth="0.8" />
        <rect x="2" y="14" width="60" height="21" rx="1" fill="#C7C3BB" />
        <rect x="2" y="22" width="60" height="13" rx="1" fill="#48484D" />
        <rect x="2" y="21.5" width="60" height="1.5" fill="#1E1E22" />
        <rect x="6" y="16.5" width="8" height="3.5" rx="0.5" fill="#8C8983" />
        <rect x="16" y="16.5" width="8" height="3.5" rx="0.5" fill="#8C8983" />
        <circle cx="28" cy="18.25" r="1.3" fill="#E5322D" />
        <rect x="38" y="26" width="7" height="5.5" rx="0.8" fill="#D8D5CE" />
        <rect x="48" y="26" width="7" height="5.5" rx="0.8" fill="#D8D5CE" />
        <rect x="39.5" y="27.5" width="4" height="2.5" fill="#2A2A2E" />
        <rect x="49.5" y="27.5" width="4" height="2.5" fill="#2A2A2E" />
    </svg>
);

export default NesLogo;
