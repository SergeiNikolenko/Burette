import type { StatusNotice } from "./types";

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
          <details className="notification-popup-details">
            <summary>Show details</summary>
            <ul>
              {details.map((detail, index) => (
                <li key={`${index}:${detail}`}>{detail}</li>
              ))}
            </ul>
          </details>
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
