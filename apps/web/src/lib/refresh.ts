import { useQueryClient } from '@tanstack/react-query';

const KEYS = {
  order: (id: string) => ['order', id],
  timeline: (id: string) => ['order-timeline', id],
  components: (id: string) => ['components', id],
  orders: () => ['orders'],
  work: () => ['work'],
} as const;

/** After a change to an order: refetch the parts of it, and the lists, that the change affects */
export function useRefreshOrder(orderId: string, parts: Array<keyof typeof KEYS>) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(parts.map((p) => queryClient.invalidateQueries({ queryKey: KEYS[p](orderId) })));
}
