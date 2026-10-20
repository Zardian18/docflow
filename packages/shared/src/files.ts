import { z } from 'zod';

// ---- Files (D24: PDF, Word, Excel and images up to 20 MB, Q63) ---------------------------

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const FILE_TYPES = {
  'application/pdf': { label: 'PDF', extension: '.pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    label: 'DOCX',
    extension: '.docx',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    label: 'XLSX',
    extension: '.xlsx',
  },
  'image/jpeg': { label: 'JPG', extension: '.jpg' },
  'image/png': { label: 'PNG', extension: '.png' },
} as const;
export type FileMime = keyof typeof FILE_TYPES;
export const FILE_MIMES = Object.keys(FILE_TYPES) as [FileMime, ...FileMime[]];
export const FileMime = z.enum(FILE_MIMES);

/** Maps a file name to an accepted MIME type by extension (browsers report DOCX inconsistently). */
export function mimeForFileName(name: string): FileMime | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpeg')) return 'image/jpeg';
  for (const mime of FILE_MIMES) {
    if (lower.endsWith(FILE_TYPES[mime].extension)) return mime;
  }
  return null;
}

// Path separators, control characters (C0, DEL, C1) and bidirectional overrides, which can
// make "invoice‮fdp.exe" display as "invoiceexe.pdf" (Phase 7 finding 11)
// eslint-disable-next-line no-control-regex
const FORBIDDEN_IN_FILE_NAME = /[/\\\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/u;

export const FileName = z
  .string()
  .trim()
  .min(1)
  .max(200, 'File name is too long')
  .refine((n) => !FORBIDDEN_IN_FILE_NAME.test(n), 'File name contains invalid characters');

export const PresignRequest = z
  .object({
    fileName: FileName,
    contentType: FileMime,
    size: z
      .number()
      .int()
      .positive('The file is empty')
      .max(MAX_UPLOAD_BYTES, 'Files can be at most 20 MB'),
  })
  .refine((v) => mimeForFileName(v.fileName) === v.contentType, {
    path: ['fileName'],
    message: 'Only PDF, Word, Excel, JPG and PNG files can be uploaded',
  });
export type PresignRequest = z.infer<typeof PresignRequest>;

export const PresignResponse = z.object({
  uploadId: z.uuid(),
  url: z.url(),
  /** Headers the browser must send with the PUT exactly as given (they are signed). */
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type PresignResponse = z.infer<typeof PresignResponse>;
