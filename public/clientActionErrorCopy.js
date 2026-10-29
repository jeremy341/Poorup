// Friendly copy for raw server error codes and misleading rejection strings.
// Unknown messages (including the server's own plain sentences such as
// "Resolve the open sponsorship before managing this property.") pass through.
const FRIENDLY_ERRORS = Object.freeze({
  OPTION_TERMS_SERVER_REQUIRED: "Options aren't available on this table yet.",
  REQUEST_ID_EXPIRED: "That action already went through or timed out. Check the table and try again.",
  MAINTENANCE_DRAINING: "The parlor is restarting. New rooms are paused for a moment. Try again shortly.",
  DELETION_IN_PROGRESS: "Account deletion is already running. Give it a moment.",
  RECOVERY_MAIL_UNAVAILABLE: "The verification email could not be sent. Try again shortly.",
  "You cannot message a blocked player in this room.": "Room chat is paused for you while a blocked player is seated here.",
  "Another trade is already pending.": "Something else is waiting on the table (an auction, an offer or another deal). Finish or dismiss it first.",
});

export function friendlyActionError(message) {
  const text = String(message ?? "").trim();
  if (Object.prototype.hasOwnProperty.call(FRIENDLY_ERRORS, text)) return FRIENDLY_ERRORS[text];
  return text;
}
