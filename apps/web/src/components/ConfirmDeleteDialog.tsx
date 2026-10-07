import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/forms';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api';

/**
 * A "Delete" button with a confirmation step. The server only deletes records with no
 * history (decisions.md D21); when it refuses, the reason is shown here and the record stays.
 */
export function DeleteButton({
  name,
  what,
  onDelete,
  onDeleted,
}: {
  /** e.g. "R. Shah" */
  name: string;
  /** e.g. "employee" */
  what: string;
  onDelete: () => Promise<unknown>;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: onDelete,
    onSuccess: () => {
      setOpen(false);
      toast.success(`Deleted ${name}`);
      onDeleted();
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="text-destructive hover:text-destructive hover:bg-status-red-bg sm:mr-auto"
        onClick={() => {
          remove.reset();
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden />
        Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Delete {what} “{name}”?
            </DialogTitle>
            <DialogDescription>
              This permanently removes it and can’t be undone. It only works for{' '}
              {/^[aeiou]/i.test(what) ? 'an' : 'a'} {what} that has no history, such as a mistake or
              a test entry. Anything used in a submitted document can only be deactivated, so past
              approvals stay readable.
            </DialogDescription>
          </DialogHeader>
          <FormError message={remove.error ? errorMessage(remove.error) : undefined} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending || remove.isError}
            >
              {remove.isPending ? 'Deleting…' : `Delete ${what}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
