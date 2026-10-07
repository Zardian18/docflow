import { describe, expect, it } from 'vitest';
import {
  InvoiceFields,
  MAX_UPLOAD_BYTES,
  mimeForFileName,
  PresignRequest,
  WorkflowCreate,
  workflowStatusLabel,
} from './workflows.js';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('upload rules (D20)', () => {
  it('accepts PDF and DOCX up to 10 MB', () => {
    expect(
      PresignRequest.safeParse({ fileName: 'Invoice.PDF', contentType: PDF, size: 1 }).success,
    ).toBe(true);
    expect(
      PresignRequest.safeParse({ fileName: 'a.docx', contentType: DOCX, size: MAX_UPLOAD_BYTES })
        .success,
    ).toBe(true);
  });

  it('rejects other types, empty files and anything over 10 MB', () => {
    expect(PresignRequest.safeParse({ fileName: 'a.exe', contentType: PDF, size: 1 }).success).toBe(
      false,
    );
    expect(
      PresignRequest.safeParse({ fileName: 'a.pdf', contentType: 'text/html', size: 1 }).success,
    ).toBe(false);
    expect(PresignRequest.safeParse({ fileName: 'a.pdf', contentType: PDF, size: 0 }).success).toBe(
      false,
    );
    expect(
      PresignRequest.safeParse({ fileName: 'a.pdf', contentType: PDF, size: MAX_UPLOAD_BYTES + 1 })
        .success,
    ).toBe(false);
  });

  it('rejects a declared type that does not match the extension', () => {
    expect(
      PresignRequest.safeParse({ fileName: 'a.pdf', contentType: DOCX, size: 1 }).success,
    ).toBe(false);
  });

  it('rejects path separators in names', () => {
    expect(
      PresignRequest.safeParse({ fileName: '../a.pdf', contentType: PDF, size: 1 }).success,
    ).toBe(false);
  });

  it('maps extensions to MIME types', () => {
    expect(mimeForFileName('x.Docx')).toBe(DOCX);
    expect(mimeForFileName('x.doc')).toBeNull();
  });
});

describe('invoice fields (D6)', () => {
  it('are all optional, with INR as the default currency', () => {
    expect(InvoiceFields.parse({})).toEqual({
      invoiceNumber: null,
      vendorName: null,
      invoiceDate: null,
      amount: null,
      currency: 'INR',
      notes: null,
    });
  });

  it('normalise blanks, commas and currency case', () => {
    const v = InvoiceFields.parse({
      invoiceNumber: '  ',
      amount: '1,25,000.50',
      currency: 'usd',
      invoiceDate: '',
    });
    expect(v).toMatchObject({
      invoiceNumber: null,
      amount: '125000.50',
      currency: 'USD',
      invoiceDate: null,
    });
  });

  it('reject malformed amounts, dates and currencies', () => {
    expect(InvoiceFields.safeParse({ amount: '12.345' }).success).toBe(false);
    expect(InvoiceFields.safeParse({ amount: '-5' }).success).toBe(false);
    expect(InvoiceFields.safeParse({ invoiceDate: '31/08/2026' }).success).toBe(false);
    expect(InvoiceFields.safeParse({ currency: 'RUPEE' }).success).toBe(false);
  });

  it('flow into the create payload', () => {
    const id = '6f1a8d2e-3b4c-4d5e-8f90-123456789abc';
    const parsed = WorkflowCreate.parse({
      uploadId: id,
      companyId: id,
      approvers: [],
      vendorName: 'Acme',
    });
    expect(parsed.vendorName).toBe('Acme');
  });
});

describe('workflowStatusLabel', () => {
  it('uses the agreed wording', () => {
    expect(workflowStatusLabel('PENDING_APPROVER', 2)).toBe('Pending Approver (Position 2)');
    expect(workflowStatusLabel('PENDING_CFO', 3)).toBe('Pending CFO');
  });
});
