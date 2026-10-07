/** The two reviewer variants: approver (screens 06/07) and CFO (screens 08/09). */
export type ReviewerKind = 'approver' | 'cfo';

export const REVIEWER = {
  approver: {
    base: '/approvals',
    pendingTitle: 'Pending Approvals',
    pendingDescription: 'Documents waiting for your review, in the order they arrived',
    stats: ['Awaiting You', 'Approved This Week', 'Rejected This Week'],
    emptyTitle: 'Nothing is waiting for you',
    emptyBody: 'Documents appear here when they reach your step in an approval chain.',
    historyDescription: 'Documents you have approved or rejected',
  },
  cfo: {
    base: '/final-approvals',
    pendingTitle: 'Pending Final Approval',
    pendingDescription: 'Every document that has cleared its approval chain and awaits you',
    stats: ['Pending CFO', 'Completed This Month', 'Rejected This Month'],
    emptyTitle: 'Nothing is waiting for your final approval',
    emptyBody: 'Documents appear here once every approver in their chain has approved.',
    historyDescription: 'Documents you have signed off or rejected',
  },
} as const;
