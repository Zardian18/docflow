/** One option of a list filter */
export interface Choice {
  value: string;
  label: string;
}

/** A local calendar date (YYYY-MM-DD) as the instant its day starts or ends */
export const dayStart = (d?: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
export const dayEnd = (d?: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);
