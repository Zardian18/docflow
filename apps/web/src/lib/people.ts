import { CAPABILITY_LABEL, TEAM_LABEL, type Me } from '@docflow/shared';

/** Whether this person has work of their own: a team, or a capability other than Admin */
export const hasWork = (me: Pick<Me, 'teams' | 'capabilities'>) =>
  me.teams.length > 0 || me.capabilities.some((c) => c !== 'ADMIN');

/** Where someone lands after signing in: their work, or the orders list for Admin only */
export const homeFor = (me: Pick<Me, 'teams' | 'capabilities'>) =>
  hasWork(me) ? '/work' : '/orders';

/** "Regulation, Production · Marketing" for the account menu */
export const describeMe = (me: Pick<Me, 'teams' | 'capabilities'>) =>
  [
    me.teams.map((t) => TEAM_LABEL[t]).join(', '),
    me.capabilities.map((c) => CAPABILITY_LABEL[c]).join(', '),
  ]
    .filter(Boolean)
    .join(' · ') || 'No access yet';
