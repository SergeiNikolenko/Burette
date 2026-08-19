export function FileThumbnailFallback({
  extension,
}: {
  extension: string | null;
}) {
  return (
    <div
      data-slot="file-thumbnail-fallback"
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-1/3 opacity-40"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path d="M6 2.5h8L19 7v13.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1Z" />
        <path d="M14 2.5V7h5" />
      </svg>
      {extension ? (
        <span className="max-w-[80%] truncate text-[0.625rem] font-medium tracking-wide uppercase opacity-70">
          {extension}
        </span>
      ) : null}
    </div>
  );
}
