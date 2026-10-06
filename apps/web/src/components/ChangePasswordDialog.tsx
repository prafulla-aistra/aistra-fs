import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { Link } from 'react-router';
import type { PasswordResetLinkResponse } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';

/** User menu → Change password: emails a one-time link to the user's address. */
export function ChangePasswordDialog({
  open,
  email,
  onClose,
}: {
  open: boolean;
  email: string;
  onClose: () => void;
}) {
  const send = useMutation({
    mutationFn: () => api.post<PasswordResetLinkResponse>('/auth/password-reset/request'),
  });
  const close = () => {
    send.reset();
    onClose();
  };
  const sent = send.data;
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Change password"
      footer={
        sent ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={send.isPending} onClick={() => send.mutate()}>
              Email me the link
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm">
        {send.error && <Alert>{errorMessage(send.error)}</Alert>}
        {sent ? (
          <Alert variant="success">
            <span className="flex items-start gap-2">
              <MailCheck className="mt-0.5 size-4 shrink-0" />
              <span>
                {sent.delivery === 'EMAIL'
                  ? `A link to change your password was sent to ${sent.sentTo}. It works once and expires in ${sent.expiresInMinutes} minutes.`
                  : `No mail server is configured yet, so the email to ${sent.sentTo} was saved in the local outbox (data/outbox) and the link printed in the API log. It works once and expires in ${sent.expiresInMinutes} minutes.`}
              </span>
            </span>
          </Alert>
        ) : (
          <p>
            We will email a link to <strong>{email}</strong>. Open it to choose a new password; you
            will then sign in again with the new password.
          </p>
        )}
        {!sent && (
          <p className="text-xs text-muted-foreground">
            Know your current password?{' '}
            <Link to="/change-password" onClick={close}>
              Change it here instead
            </Link>
            .
          </p>
        )}
      </div>
    </Dialog>
  );
}
