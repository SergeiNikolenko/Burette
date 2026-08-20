export function viewerScrollbarCss(slotName: string) {
  return `
[data-slot="${slotName}"]::-webkit-scrollbar { width: 10px; height: 10px; }
[data-slot="${slotName}"]::-webkit-scrollbar:vertical { display: none; }
[data-slot="${slotName}"]::-webkit-scrollbar-track { background: transparent; }
[data-slot="${slotName}"]::-webkit-scrollbar-thumb {
  background-color: color-mix(in oklab, var(--foreground) 22%, transparent);
  border-radius: 9999px;
  border: 3px solid transparent;
  background-clip: content-box;
}
[data-slot="${slotName}"]::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in oklab, var(--foreground) 38%, transparent);
}
`;
}
