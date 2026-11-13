import { Command } from 'lucide-react';

export function BrandLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center bg-black text-white shadow-sm ring-1 ring-black/10 ${size >= 48 ? 'rounded-2xl' : 'rounded-md'} ${className}`}
    >
      <Command size={size / 2} />
    </span>
  );
}
