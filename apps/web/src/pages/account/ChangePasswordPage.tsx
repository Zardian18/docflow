import { ChangePasswordRequest, PASSWORD_MIN_LENGTH } from '@docflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field, FormError, PasswordInput } from '@/components/forms';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';

const Schema = ChangePasswordRequest.extend({ confirm: z.string() }).refine(
  (v) => v.newPassword === v.confirm,
  { path: ['confirm'], message: 'Passwords do not match' },
);

export function ChangePasswordPage() {
  const form = useForm({
    resolver: zodResolver(Schema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const change = useMutation({
    mutationFn: (v: z.infer<typeof Schema>) =>
      api.auth.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      form.reset();
      toast.success('Password changed. Other devices have been signed out.');
    },
  });
  const errors = form.formState.errors;

  return (
    <>
      <PageHeader
        title="Change password"
        description="Changing it signs you out everywhere else."
      />
      <PageBody>
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => change.mutate(v))}
          className="bg-card flex max-w-md flex-col gap-4 rounded-xl border p-5 sm:p-6"
        >
          <FormError message={change.error ? errorMessage(change.error) : undefined} />
          <Field label="Current password" error={errors.currentPassword?.message}>
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="current-password"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('currentPassword')}
              />
            )}
          </Field>
          <Field
            label="New password"
            error={errors.newPassword?.message}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          >
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('newPassword')}
              />
            )}
          </Field>
          <Field label="Confirm new password" error={errors.confirm?.message}>
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
          <Button type="submit" className="self-start" disabled={change.isPending}>
            {change.isPending ? 'Saving…' : 'Change password'}
          </Button>
        </form>
      </PageBody>
    </>
  );
}
