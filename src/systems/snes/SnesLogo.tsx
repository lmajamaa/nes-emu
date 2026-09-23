import type { SVGProps } from 'react';

const SnesLogo = (props: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 64 40" role="img" aria-label="SNES" {...props}>
        <rect x="2" y="12" width="60" height="24" rx="7" fill="#C9C6CF" />
        <rect x="2" y="27" width="60" height="9" rx="4.5" fill="#B3AFBB" />
        <rect x="16" y="5" width="32" height="14" rx="4" fill="#DCD9E0" />
        <rect x="21" y="8" width="22" height="4" rx="1" fill="#3F3C48" />
        <rect x="7" y="16" width="7" height="3.5" rx="1.5" fill="#7B6FC4" />
        <rect x="50" y="16" width="7" height="3.5" rx="1.5" fill="#7B6FC4" />
        <circle cx="32" cy="22.5" r="2.2" fill="#7B6FC4" />
        <rect x="21" y="29.5" width="6" height="4" rx="1" fill="#55525E" />
        <rect x="37" y="29.5" width="6" height="4" rx="1" fill="#55525E" />
    </svg>
);

export default SnesLogo;
