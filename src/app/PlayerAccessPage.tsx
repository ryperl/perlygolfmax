import { OwnerAccess } from '../features/admission';
import type { OwnerAccessProps } from '../features/admission';
import { TesterLinks } from '../features/test-access';
import type { TesterAccessClient } from '../client/test-access';

export function PlayerAccessPage({ testerAccess, ...props }: OwnerAccessProps & {
  readonly testerAccess?: TesterAccessClient | undefined;
}) {
  if (!testerAccess) return <OwnerAccess {...props} />;
  return <>
    <TesterLinks client={testerAccess} eventId={props.eventId} onSessionExpired={props.onSessionExpired} />
    <details><summary>Account-based player invitations</summary><OwnerAccess {...props} /></details>
  </>;
}
