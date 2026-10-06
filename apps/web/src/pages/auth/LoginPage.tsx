import { LoginRequest } from '@docflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Field, FormError, PasswordInput } from '@/components/forms';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError, errorMessage } from '@/lib/api';
import { HOME_BY_PERMISSION, meQueryKey, useMe } from '@/lib/auth';
import { AuthCard } from './AuthCard';

/** Only follow same-app relative paths after login (no open redirects). */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function LoginPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const next = safeNext(params.get('next'));

  const form = useForm({
    resolver: zodResolver(LoginRequest),
    defaultValues: { email: '', password: '' },
  });
  const login = useMutation({
    mutationFn: api.auth.login,
    onSuccess: (user) => {
      queryClient.setQueryData(meQueryKey, user);
      navigate(next ?? HOME_BY_PERMISSION[user.permission], { replace: true });
    },
  });

  if (me.isPending) return <FullPageSpinner />;
  if (me.data) return <Navigate to={next ?? HOME_BY_PERMISSION[me.data.permission]} replace />;

  const errors = form.formState.errors;
  const loginError =
    login.error instanceof ApiError && login.error.code === 'VALIDATION'
      ? 'Enter a valid email address and your password.'
      : login.error && errorMessage(login.error);

  return (
    <AuthCard
      title="DocFlow"
      subtitle="Document Approval Workflow System"
      footer="Access is provisioned by your Admin. Contact your administrator if you need an account."
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={form.handleSubmit((v) => login.mutate(v))}
      >
        <FormError message={loginError || undefined} />
        <Field label="Email" error={errors.email?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              autoComplete="username"
              inputMode="email"
              placeholder="name@company.com"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoFocus
              {...form.register('email')}
            />
          )}
        </Field>
        <Field label="Password" error={errors.password?.message}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="current-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('password')}
            />
          )}
        </Field>
        <Button type="submit" className="mt-1 h-10" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
        <Link
          to="/forgot-password"
          className="text-primary self-center text-[13px] hover:underline"
        >
          Forgot your password?
        </Link>
      </form>
    </AuthCard>
  );
}
