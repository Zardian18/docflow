import type { Capability } from '@docflow/shared';
import { Link, Navigate, Outlet, createBrowserRouter, useRouteError } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { homeFor } from '@/lib/people';
import { ChangePasswordPage } from '@/pages/account/ChangePasswordPage';
import { BuyerFormPage } from '@/pages/admin/buyers/BuyerFormPage';
import { BuyersPage } from '@/pages/admin/buyers/BuyersPage';
import { EmployeesPage } from '@/pages/admin/EmployeesPage';
import { AuthCard } from '@/pages/auth/AuthCard';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { SetPasswordPage } from '@/pages/auth/SetPasswordPage';
import { NewOrderPage } from '@/pages/orders/NewOrderPage';
import { OrderPage } from '@/pages/orders/OrderPage';
import { OrdersPage } from '@/pages/orders/OrdersPage';
import { WorkPage } from '@/pages/work/WorkPage';

function Allow({ capabilities }: { capabilities: Capability[] }) {
  return <RequireAuth allow={capabilities}>{() => <Outlet />}</RequireAuth>;
}

function RouteError() {
  const error = useRouteError();
  return (
    <AuthCard title="Something went wrong" subtitle={errorMessage(error)}>
      <Button className="h-10 w-full" onClick={() => window.location.reload()}>
        Reload the page
      </Button>
    </AuthCard>
  );
}

function NotFound() {
  return (
    <AuthCard title="Page not found" subtitle="The link may be old, or the page has moved.">
      <Button asChild className="h-10 w-full">
        <Link to="/">Go to your home page</Link>
      </Button>
    </AuthCard>
  );
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/set-password', element: <SetPasswordPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      {
        element: <RequireAuth>{(me) => <AppShell me={me} />}</RequireAuth>,
        children: [
          {
            index: true,
            element: <RequireAuth>{(me) => <Navigate to={homeFor(me)} replace />}</RequireAuth>,
          },
          { path: '/account/password', element: <ChangePasswordPage /> },
          { path: '/work', element: <WorkPage /> },
          { path: '/orders', element: <OrdersPage /> },
          { path: '/orders/:id', element: <OrderPage /> },
          {
            element: <Allow capabilities={['MARKETING']} />,
            children: [{ path: '/orders/new', element: <NewOrderPage /> }],
          },
          {
            element: <Allow capabilities={['ADMIN', 'MARKETING']} />,
            children: [
              { path: '/admin/buyers', element: <BuyersPage /> },
              { path: '/admin/buyers/new', element: <BuyerFormPage /> },
              { path: '/admin/buyers/:id', element: <BuyerFormPage /> },
            ],
          },
          {
            element: <Allow capabilities={['ADMIN']} />,
            children: [
              { path: '/admin', element: <Navigate to="/orders" replace /> },
              { path: '/admin/employees', element: <EmployeesPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
