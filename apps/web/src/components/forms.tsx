import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useId, useState, type ComponentProps, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Label + control + hint/error, wired for screen readers. */
export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} className="text-muted-foreground text-[13px] font-normal">
        {label}
      </Label>
      {children({ id, describedBy: message ? messageId : undefined, invalid: Boolean(error) })}
      {message && (
        <p
          id={messageId}
          className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {message}
        </p>
      )}
    </div>
  );
}

/** Password input with a show/hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, ComponentProps<typeof Input>>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-10', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  },
);

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="bg-status-red-bg text-status-red rounded-lg px-3 py-2 text-sm">
      {message}
    </p>
  );
}

export interface CheckboxOption {
  value: string;
  label: ReactNode;
  /** Shown under the label, e.g. why it can't be picked */
  note?: string;
  disabled?: boolean;
}

/** A labelled group of checkboxes (a fieldset, so screen readers announce the group). */
export function CheckboxList({
  legend,
  options,
  value,
  onChange,
  error,
  hint,
}: {
  legend: string;
  options: CheckboxOption[];
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const message = error ?? hint;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1.5"
      aria-describedby={message ? `${id}-message` : undefined}
      aria-invalid={Boolean(error) || undefined}
    >
      <legend className="text-muted-foreground mb-1.5 text-[13px]">{legend}</legend>
      <div className="border-input flex flex-col divide-y rounded-lg border">
        {options.map((o) => {
          const checked = value.includes(o.value);
          return (
            <label
              key={o.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm',
                o.disabled && !checked && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="checkbox"
                className="accent-primary mt-0.5 size-4 shrink-0"
                checked={checked}
                disabled={o.disabled && !checked}
                onChange={(e) =>
                  onChange(
                    e.currentTarget.checked
                      ? [...value, o.value]
                      : value.filter((v) => v !== o.value),
                  )
                }
              />
              <span className="flex min-w-0 flex-col">
                <span>{o.label}</span>
                {o.note && <span className="text-muted-foreground text-xs">{o.note}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {message && (
        <p
          id={`${id}-message`}
          className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {message}
        </p>
      )}
    </fieldset>
  );
}
