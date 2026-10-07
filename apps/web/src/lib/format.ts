import { format } from 'date-fns';

/** "24 Aug 2026", as in the designs. */
export const formatDate = (iso: string) => format(new Date(iso), 'd MMM yyyy');

/** "23 Aug 2026, 10:14 AM", as in the approval history of screens 07/08. */
export const formatDateTime = (iso: string) => format(new Date(iso), 'd MMM yyyy, h:mm a');

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Amount with grouping for its currency; INR uses the Indian lakh/crore grouping. */
export function formatAmount(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
