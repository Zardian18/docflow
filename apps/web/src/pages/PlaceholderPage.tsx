import { PageBody, PageHeader } from '@/components/PageHeader';

/** Screens that later phases fill in. Copy is written for the people who will see them. */
export function PlaceholderPage({
  title,
  description,
  note,
}: {
  title: string;
  description: string;
  note: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <PageBody>
        <div className="bg-card text-muted-foreground rounded-xl border px-5 py-10 text-center text-sm">
          {note}
        </div>
      </PageBody>
    </>
  );
}
