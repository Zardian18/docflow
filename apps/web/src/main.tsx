import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError, setForbiddenHandler, setUnauthorizedHandler } from '@/lib/api';
import { meQueryKey } from '@/lib/auth';
import { router } from '@/router';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Don't retry client errors (401/403/404/409...); do retry flaky network once
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
    },
  },
});

// Session expired or revoked mid-use: forget the user; protected routes then redirect to /login
setUnauthorizedHandler(() => {
  queryClient.setQueryData(meQueryKey, null);
});

// A refusal usually means another tab signed in as someone else (tabs share one cookie).
// Re-check who is signed in: AppShell announces a change and RequireAuth sends this tab to
// the new user's home page, instead of leaving a page that can only fail.
setForbiddenHandler(() => {
  void queryClient.invalidateQueries({ queryKey: meQueryKey });
});

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
