import { describe, expect, it } from 'vitest';
import { Permission, PingResponse, WorkflowStatus } from './index.js';

describe('enums', () => {
  it('has exactly the four permissions', () => {
    expect(Permission.options).toEqual(['ADMIN', 'CREATOR', 'APPROVER', 'CFO']);
  });

  it('rejects unknown workflow statuses', () => {
    expect(WorkflowStatus.safeParse('DRAFT').success).toBe(false);
  });
});

describe('PingResponse', () => {
  it('accepts a valid payload', () => {
    const ok = PingResponse.safeParse({
      message: 'pong',
      dbTime: '2026-10-05T10:00:00.000Z',
      roleCount: 0,
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a negative role count', () => {
    const bad = PingResponse.safeParse({
      message: 'pong',
      dbTime: '2026-10-05T10:00:00.000Z',
      roleCount: -1,
    });
    expect(bad.success).toBe(false);
  });
});
