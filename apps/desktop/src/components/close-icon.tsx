export function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="close-glyph"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4.6 4.6L11.4 11.4M11.4 4.6L4.6 11.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}
