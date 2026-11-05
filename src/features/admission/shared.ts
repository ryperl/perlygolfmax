import { EventChangedError, SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';

export function admissionFailure(error: unknown) {
  const status = error instanceof PrivateRequestError ? error.status : undefined;
  const expired = error instanceof SessionExpiredError || status === 401;
  const denied = expired || status === 403 || status === 404;
  const conflict = error instanceof EventChangedError || status === 409;
  return {
    expired, denied, conflict,
    definitive: status !== undefined && status >= 400 && status < 500 && ![408, 429].includes(status),
    message: expired ? 'Your session expired. Sign in again.'
      : status === 403 ? 'This account does not have access. Use the account that requested access or contact the organizer.'
        : status === 404 ? 'This invitation or event is unavailable. Ask the organizer for a new invitation.'
          : status === 410 ? 'This invitation has expired. Ask the organizer for a replacement link.'
            : conflict ? 'The event or invitation changed. Refresh and review before making a new attempt.'
              : status === 400 ? 'The request was not accepted. Check the verification code or ask for a replacement link.'
                : 'The service did not confirm the operation. Retry the original attempt; do not assume access was granted.',
  };
}
