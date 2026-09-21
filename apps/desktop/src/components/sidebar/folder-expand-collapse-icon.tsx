export function FolderExpandCollapseIcon({ collapse }: { collapse: boolean }) {
  return collapse ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 3.5L6.9 6.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6.9 4.7V6.9H4.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 12.5L9.1 9.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9.1 11.3V9.1H11.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.9 6.9L3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3.5 5.7V3.5H5.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.1 9.1L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M12.5 10.3V12.5H10.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

