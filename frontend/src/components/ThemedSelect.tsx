import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface ThemedSelectProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  editable?: boolean;
  placeholder?: string;
  required?: boolean;
  openOnLoad?: boolean;
}

export function ThemedSelect({ label, value, options, onChange, editable, placeholder, required, openOnLoad }: ThemedSelectProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  useEffect(() => {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [options, value]);

  useEffect(() => {
    setOpen(Boolean(openOnLoad && options.length));
    if (openOnLoad && options.length) input.current?.focus();
  }, [options, openOnLoad]);

  useEffect(() => {
    if (open) root.current?.querySelectorAll('[role="option"]')[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  function handleKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (['ArrowDown', 'ArrowUp'].includes(event.key) && options.length) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (open && event.key === 'Enter') {
      event.preventDefault();
      if (options[active]) onChange(options[active].value);
      setOpen(false);
    } else if (event.key === 'Tab') setOpen(false);
  }

  const controlClass = 'w-full min-h-[42px] rounded-lg border border-black/10 bg-white px-3 py-2.5 pr-10 text-left text-[13px] text-zinc-900 outline-none shadow-sm transition focus:border-black focus:ring-2 focus:ring-black/10';
  const combobox = {
    id,
    role: 'combobox',
    'aria-label': label,
    'aria-expanded': open,
    'aria-controls': `${id}-list`,
    'aria-activedescendant': open && options[active] ? `${id}-option-${active}` : undefined,
    onKeyDown: handleKey,
  } as const;

  return (
    <div ref={root} className="relative min-w-0" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      {editable ? (
        <input ref={input} {...combobox} className={controlClass} value={value} placeholder={placeholder} required={required} autoComplete="off"
          onChange={(event) => { onChange(event.target.value); setOpen(false); }} />
      ) : (
        <button {...combobox} className={controlClass} type="button" onClick={() => setOpen(!open)}>
          {options.find((option) => option.value === value)?.label || placeholder || value}
        </button>
      )}
      {editable ? (
        <button className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
          type="button" aria-label="展开模型列表" disabled={!options.length} onClick={() => setOpen(!open)}>
          <ChevronDown size={16} />
        </button>
      ) : <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 text-zinc-500" />}
      {open && options.length > 0 && (
        <div id={`${id}-list`} role="listbox" aria-label={label} className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-64 overflow-auto rounded-xl border border-black/10 bg-white p-1.5 shadow-xl shadow-black/10">
          {options.map((option, index) => (
            <button key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={value === option.value} type="button" tabIndex={-1}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => { onChange(option.value); setOpen(false); }}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] break-all transition-colors ${active === index || value === option.value ? 'bg-zinc-100 text-black' : 'text-zinc-600 hover:bg-zinc-50'}`}>
              <span>{option.label}</span>
              {value === option.value && <Check size={14} className="shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
