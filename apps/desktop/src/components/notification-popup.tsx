import * as Dialog from "@radix-ui/react-dialog";
import { useThemePortalContainer } from "./radix-menu";
import type { StatusNotice } from "./types";
import { CloseIcon } from "./close-icon";

export function NotificationPopup({
  notice,
  onDismiss,
}: {
  notice: StatusNotice;
  onDismiss: () => void;
}) {
  const message = compactNotificationMessage(notice.message);
  const details = message === notice.message ? notice.details : [notice.message, ...notice.details];
  const hasExtraDetails = details.length > 0;
  const portalContainer = useThemePortalContainer();

  return (
    <section
      className="notification-popup"
      data-kind={notice.kind}
      role={notice.kind === "error" ? "alert" : "status"}
      aria-live={notice.kind === "error" ? "assertive" : "polite"}
    >
      <div className="notification-popup-copy">
        <strong>{notice.kind === "error" ? "Issue" : "Status"}</strong>
        <p>{message}</p>
        {hasExtraDetails && (
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <button type="button" className="notification-popup-details-trigger">Show details</button>
            </Dialog.Trigger>
            <Dialog.Portal container={portalContainer}>
              <Dialog.Overlay className="radix-dialog-overlay" />
              <Dialog.Content className="radix-dialog" aria-describedby="notification-details-body">
                <div className="radix-dialog-header">
                  <Dialog.Title>{notice.kind === "error" ? "Issue details" : "Status details"}</Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" className="radix-dialog-close" aria-label="Close details">
                        <CloseIcon size={14} />
                      </button>
                    </Dialog.Close>
                </div>
                <div id="notification-details-body" className="radix-dialog-body">
                  <ul>
                    {details.map((detail, index) => (
                      <li key={`${index}:${detail}`}>{detail}</li>
                    ))}
                  </ul>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </div>
      <button
        type="button"
        className="notification-popup-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        Dismiss
      </button>
    </section>
  );
}

function compactNotificationMessage(message: string) {
  return message.trim().split(/\r?\n| Error:| at /)[0]?.trim() || message;
}
