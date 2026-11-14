import type { LucideProps } from "lucide-react";

export function RouletteIcon({ size = 20, className, ...props }: LucideProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v7" />
      <path d="M12 15v7" />
      <path d="m4.93 4.93 4.95 4.95" />
      <path d="m14.12 14.12 4.95 4.95" />
      <path d="M2 12h7" />
      <path d="M15 12h7" />
      <path d="m4.93 19.07 4.95-4.95" />
      <path d="m14.12 9.88 4.95-4.95" />
    </svg>
  );
}
