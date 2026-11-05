import { OwnerAccess } from '../features/admission';
import type { OwnerAccessProps } from '../features/admission';

export function PlayerAccessPage(props: OwnerAccessProps) {
  return <OwnerAccess {...props} />;
}
