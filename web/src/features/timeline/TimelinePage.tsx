import { Images } from 'lucide-react';
import { MediaView } from './MediaView';
import { PageHeader } from '../shell/PageHeader';
import { StateMessage } from '@/components/ui/StateMessage';
import { useCanWrite, useVaultId } from '@/state/vaultStore';

export function TimelinePage() {
  const vaultId = useVaultId();
  const canWrite = useCanWrite();

  return (
    <>
      <PageHeader title="Timeline" />
      <MediaView
        vaultId={vaultId}
        groupByMonth
        empty={
          <StateMessage
            icon={<Images className="size-10" aria-hidden />}
            title="No photos yet"
            detail={canWrite ? 'Drag photos and videos anywhere onto this window, or use Upload.' : undefined}
          />
        }
      />
    </>
  );
}
