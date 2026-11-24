// Marks drawn inline: the platforms on the download buttons and GitHub. Each is the owner's own
// shape, used only to say where a link goes.
export function Apple(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76a4.25 4.25 0 0 0-3.59 2.18c-1.54 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13a9.4 9.4 0 0 0 1.2-2.47 3.83 3.83 0 0 1-2.29-3.52ZM14.2 6.13c.6-.74 1.01-1.76.9-2.78-.87.04-1.93.58-2.55 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.57-1.21Z" />
    </svg>
  );
}

export function Windows(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M3 5.1 10.4 4v7.1H3V5.1Zm8.3-1.2L21 2.5v8.6h-9.7V3.9ZM3 12h7.4v7.1L3 18v-6Zm8.3 0H21v8.5l-9.7-1.4V12Z" />
    </svg>
  );
}

export function GitHub(props: { className?: string; size?: number }) {
  const { size = 20, ...rest } = props;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden {...rest}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export function Npm({ mono, ...props }: { className?: string; mono?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={mono ? 20 : undefined} height={mono ? 20 : undefined} aria-hidden {...props}>
      {!mono && <rect x="3" y="3" width="18" height="18" fill="#fff" />}
      <path fill={mono ? "currentColor" : "#cb3837"} d="M1.76 0C.79 0 0 .79 0 1.76v20.48C0 23.21.79 24 1.76 24h20.48c.97 0 1.76-.79 1.76-1.76V1.76C24 .79 23.21 0 22.24 0zM5.13 5.32l13.84.02-.01 13.84h-3.46l.01-10.39h-3.46l-.01 10.38H5.11z" />
    </svg>
  );
}
