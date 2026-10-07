import type { Permission } from '@docflow/shared';
import { Link, Navigate, Outlet, createBrowserRouter, useRouteError } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { HOME_BY_PERMISSION, RequireAuth } from '@/lib/auth';
import { ChangePasswordPage } from '@/pages/account/ChangePasswordPage';
import { CompaniesPage } from '@/pages/admin/companies/CompaniesPage';
import { AdminDashboardPage } from '@/pages/admin/dashboard/AdminDashboardPage';
import { AdminWorkflowPage } from '@/pages/admin/workflow/AdminWorkflowPage';
import { CompanyFormPage } from '@/pages/admin/companies/CompanyFormPage';
import { EmployeesPage } from '@/pages/admin/EmployeesPage';
import { RolesPage } from '@/pages/admin/RolesPage';
import { AuthCard } from '@/pages/auth/AuthCard';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { SetPasswordPage } from '@/pages/auth/SetPasswordPage';
import { MySubmissionsPage } from '@/pages/creator/MySubmissionsPage';
import { NewSubmissionPage } from '@/pages/creator/NewSubmissionPage';
import { SubmissionDetailPage } from '@/pages/creator/SubmissionDetailPage';
import { HistoryPage } from '@/pages/reviewer/HistoryPage';
import { PendingPage } from '@/pages/reviewer/PendingPage';
import { ReviewPage } from '@/pages/reviewer/ReviewPage';

function Allow({ permissions }: { permissions: Permission[] }) {
  return <RequireAuth allow={permissions}>{() => <Outlet />}</RequireAuth>;
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
            element: (
              <RequireAuth>
                {(me) => <Navigate to={HOME_BY_PERMISSION[me.permission]} replace />}
              </RequireAuth>
            ),
          },
          { path: '/account/password', element: <ChangePasswordPage /> },
          {
            element: <Allow permissions={['ADMIN']} />,
            children: [
              {
                path: '/admin',
                element: <AdminDashboardPage />,
              },
              { path: '/admin/workflows/:id', element: <AdminWorkflowPage /> },
              {
                path: '/admin/masters',
                element: <Navigate to="/admin/masters/companies" replace />,
              },
              { path: '/admin/masters/companies', element: <CompaniesPage /> },
              { path: '/admin/masters/companies/new', element: <CompanyFormPage /> },
              { path: '/admin/masters/companies/:id', element: <CompanyFormPage /> },
              { path: '/admin/masters/employees', element: <EmployeesPage /> },
              { path: '/admin/masters/roles', element: <RolesPage /> },
            ],
          },
          {
            element: <Allow permissions={['CREATOR']} />,
            children: [
              { path: '/submit', element: <NewSubmissionPage /> },
              { path: '/submissions', element: <MySubmissionsPage /> },
              { path: '/submissions/:id', element: <SubmissionDetailPage /> },
            ],
          },
          {
            element: <Allow permissions={['APPROVER']} />,
            children: [
              { path: '/approvals', element: <PendingPage kind="approver" /> },
              { path: '/approvals/history', element: <HistoryPage kind="approver" /> },
              { path: '/approvals/:id', element: <ReviewPage kind="approver" /> },
            ],
          },
          {
            element: <Allow permissions={['CFO']} />,
            children: [
              { path: '/final-approvals', element: <PendingPage kind="cfo" /> },
              { path: '/final-approvals/history', element: <HistoryPage kind="cfo" /> },
              { path: '/final-approvals/:id', element: <ReviewPage kind="cfo" /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
