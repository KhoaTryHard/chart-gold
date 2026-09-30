/** Original split-K geometry, shared with scripts/generate-brand-assets.mjs. */
export function BrandMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="12" y="12" width="9" height="40" rx="0.8" />
      <path d="M26 27 41 12H53L33 32Z" />
      <path d="M26 37 33 32 53 52H41Z" />
    </svg>
  );
}
