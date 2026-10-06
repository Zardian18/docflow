import type { Me, Permission } from '@docflow/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, ApiError } from './api';
import { FullPageSpinner } from '@/components/FullPageSpinner';

export const meQueryKey = ['auth', 'me'] as const;

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async ({ signal }) => {
      try {
        return await api.auth.me(signal);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

/** Where each permission lands after signing in. */
export const HOME_BY_PERMISSION: Record<Permission, string> = {
  ADMIN: '/admin',
  CREATOR: '/submit',
  APPROVER: '/approvals',
  CFO: '/final-approvals',
};

export function useSignOutLocally() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.setQueryData(meQueryKey, null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
  };
}

/** Renders children only for a signed-in user with one of `allow`; otherwise redirects. */
export function RequireAuth({
  allow,
  children,
}: {
  allow?: Permission[];
  children: (me: Me) => ReactNode;
}) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <FullPageSpinner />;
  if (me.isError) throw me.error;
  if (!me.data) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (allow && !allow.includes(me.data.permission)) {
    return <Navigate to={HOME_BY_PERMISSION[me.data.permission]} replace />;
  }
  return children(me.data);
}
