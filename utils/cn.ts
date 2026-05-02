import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility for constructing class strings with clsx + tailwind-merge.
 * Resolves Tailwind conflicts and supports conditional / array class values.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
