export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="9" fill="#FFD84D" stroke="currentColor" strokeWidth="3" />
      <path d="M9 27 V13 l6 8 6-8 v14" fill="none" stroke="#171411" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23 21 l4 5 8-13" fill="none" stroke="#D92D1A" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
