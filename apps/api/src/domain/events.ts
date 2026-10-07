/**
 * One readable line per audit event for the activity log. Built from the stored payload,
 * so the log stays readable after completion or rejection without exposing raw JSON.
 */
export function summarizeEvent(type: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const quote = (v: unknown) => (typeof v === 'string' && v ? `: “${v}”` : '');
  const name = (v: unknown) =>
    v && typeof v === 'object' && 'name' in v ? String((v as { name: unknown }).name) : 'someone';
  switch (type) {
    case 'SUBMITTED':
      return p.chainCustomised
        ? 'Submitted with an approval chain customised for this document'
        : 'Submitted with the company’s default approval chain';
    case 'APPROVED':
      return p.isCfo
        ? `Final approval given${quote(p.remarks)}`
        : `Approved at position ${p.position}${quote(p.remarks)}`;
    case 'REJECTED':
      return p.isCfo
        ? `Rejected at the final step${quote(p.remarks)}`
        : `Rejected at position ${p.position}${quote(p.remarks)}`;
    case 'ADVANCED':
      return `Moved on from position ${p.from} to position ${p.to}`;
    case 'COMPLETED':
      return 'Completed';
    case 'REASSIGNED':
      return `Reassigned position ${p.position} from ${name(p.from)} to ${name(p.to)}${quote(p.reason)}`;
    default:
      return type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}
