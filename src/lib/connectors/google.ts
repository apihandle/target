import { defineConnector } from "@/lib/connectors/define";
import type { ConnectionInfo } from "@/lib/connectors/types";
import { SCOPES, LEGACY_SCOPES, guardTool, type GTool } from "@/lib/connectors/google/shared";
import { GMAIL_TOOLS } from "@/lib/connectors/google/gmail";
import { CALENDAR_TOOLS } from "@/lib/connectors/google/calendar";
import { DRIVE_TOOLS } from "@/lib/connectors/google/drive";
import { WORKSPACE_TOOLS } from "@/lib/connectors/google/workspace";

/**
 * Google (Gmail, Calendar, Drive, Sheets, Docs, Contacts) via the official REST APIs and the OAuth 2.0 web-server
 * flow (also connected by "Continue with Google", see googleLoginScopes.ts).
 *
 * Every tool is offered once Google is connected. A tool whose scope the connection lacks (older connections were
 * granted gmail.readonly / gmail.compose / calendar.events / drive.readonly) answers "Reconnect Google to allow
 * this" with a Reconnect card instead of failing. Anything that sends, shares or deletes goes through an approval
 * card (see each tool's requiresApproval).
 */
export { SCOPES, LEGACY_SCOPES } from "@/lib/connectors/google/shared";
export { siteDomain, extractVerification } from "@/lib/connectors/google/verify";
export { parseAddresses, buildMime } from "@/lib/connectors/google/mime";
export { sendMail } from "@/lib/connectors/google/gmail";
export { createEvent } from "@/lib/connectors/google/calendar";

/** Granted scopes that let TARGET read Gmail (current or legacy grant). */
export const canReadGmail = (scopes: string[]) => [SCOPES.gmail, LEGACY_SCOPES.gmailRead, "https://mail.google.com/"].some((s) => scopes.includes(s));

export const ALL_TOOLS: GTool[] = [...GMAIL_TOOLS, ...CALENDAR_TOOLS, ...DRIVE_TOOLS, ...WORKSPACE_TOOLS];

export const google = defineConnector({
  id: "google",
  name: "Google",
  icon: "G",
  description: "Gmail, Calendar, Drive, Sheets, Docs and Contacts: read, search, organise, reply, forward, schedule, share and file things; anything that sends, shares or deletes waits for your approval.",
  auth: "oauth",
  scopes: ["openid", "email", SCOPES.gmail, SCOPES.calendar, SCOPES.drive, SCOPES.contacts, SCOPES.otherContacts],
  addedScopes: [SCOPES.gmail, SCOPES.calendar, SCOPES.drive, SCOPES.contacts, SCOPES.otherContacts],
  capabilities: [
    "Gmail: search and read mail, threads and attachments; drafts; send, reply, reply-all and forward (with attachments from Drive or a link) after you approve",
    "Gmail: labels, archive, mark read/unread, star, trash/untrash (several at once asks you first)",
    "Calendar: list calendars and events, find free time, create (also recurring, with guests or a Meet link), quick add, edit, move, delete and RSVP",
    "Drive: search, list folders, read files, create folders, upload, create Docs and Sheets, move, rename, copy, export to PDF/DOCX/XLSX, share and trash (asks you first)",
    "Sheets and Docs: read ranges, append rows, update cells, read and add text",
    "Contacts: look up someone's email address by name",
  ],
  permissions: [
    "gmail.modify: read, organise (labels, archive, read/unread, star, trash) and send email. It can't permanently delete mail. Every email, reply and forward waits for your approval, showing the recipients and text, before it is sent.",
    "calendar: see your calendars and free/busy, and add or change events. New events, invitations, RSVPs and changes to events with other guests wait for your approval.",
    "drive: see and manage your Drive files, including Google Docs and Sheets. Sharing, unsharing, trashing and deleting wait for your approval.",
    "contacts.readonly and contacts.other.readonly: look up email addresses in your contacts and people you've emailed (read only).",
    "You can untick permissions on Google's consent screen; TARGET then asks you to reconnect only when a task needs one. Revoke any time at myaccount.google.com/permissions.",
  ],
  requiredEnv: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    tokenAuth: "body",
    pkce: true,
    refreshable: true,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    async accountLabel(_t, j) {
      if (typeof j.id_token !== "string") return "";
      try { return String(JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email ?? ""); } catch { return ""; }
    },
    async revoke(creds, _env, f) {
      const t = creds.refresh_token ?? creds.access_token;
      await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => undefined);
    },
  },
  docs: [
    "https://developers.google.com/identity/protocols/oauth2/web-server",
    "https://developers.google.com/gmail/api/reference/rest",
    "https://developers.google.com/calendar/api/v3/reference",
    "https://developers.google.com/drive/api/reference/rest/v3",
    "https://developers.google.com/sheets/api/reference/rest",
    "https://developers.google.com/docs/api/reference/rest",
    "https://developers.google.com/people/api/rest",
  ],
  todo: [
    "gmail.modify and drive are restricted scopes; calendar and contacts are sensitive. Until Google verifies the app, users see an \"unverified app\" warning and restricted scopes are capped at 100 users.",
    "Enable in Google Cloud (APIs & Services): Gmail API, Google Calendar API, Google Drive API, Google Sheets API, Google Docs API, People API.",
  ],
  getTools: (conn: ConnectionInfo) => ALL_TOOLS.map((t) => guardTool(t, conn.scopes ?? [])),
});
