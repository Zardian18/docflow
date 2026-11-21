import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';

/** Opens a document in a new tab (view) or saves it (download), with a short-lived link */
export async function openDocument(id: string, mode: 'view' | 'download') {
  try {
    const link = await api.documents.fileLink(id, mode);
    if (mode === 'view') window.open(link.url, '_blank', 'noopener');
    else window.location.assign(link.url);
  } catch (err) {
    toast.error(errorMessage(err));
  }
}
