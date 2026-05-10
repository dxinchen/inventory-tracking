import { useEffect, type RefObject } from 'react';

/** Call `onOutside` when a mousedown fires outside `ref`. Disabled when `enabled` is false. */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOutside, enabled]);
}
