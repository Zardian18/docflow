import { Password, PASSWORD_MIN_LENGTH } from '@docflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field, FormError, PasswordInput } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { AuthCard } from './AuthCard';

const Schema = z
  .object({ password: Password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });

/** Opened from the one-time link an Admin shares (D16). Works for first-time and reset links. */
export function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const form = useForm({
    resolver: zodResolver(Schema),
    defaultValues: { password: '', confirm: '' },
  });
  const setPassword = useMutation({
    mutationFn: (password: string) => api.auth.setPassword({ token, password }),
    onSuccess: () => {
      toast.success('Password saved. Sign in with your new password.');
      navigate('/login', { replace: true });
    },
  });

  if (!token) {
    return (
      <AuthCard
        title="Link incomplete"
        subtitle="This page needs the full link your administrator sent you."
      >
        <Button asChild className="h-10 w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  const errors = form.formState.errors;
  return (
    <AuthCard
      title="Set your password"
      subtitle={`Use at least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easiest to remember.`}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={form.handleSubmit((v) => setPassword.mutate(v.password))}
      >
        <FormError message={setPassword.error ? errorMessage(setPassword.error) : undefined} />
        <Field label="New password" error={errors.password?.message}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoFocus
              {...form.register('password')}
            />
          )}
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('confirm')}
            />
          )}
        </Field>
        <Button type="submit" className="mt-1 h-10" disabled={setPassword.isPending}>
          {setPassword.isPending ? 'Saving…' : 'Save password'}
        </Button>
      </form>
    </AuthCard>
  );
}
