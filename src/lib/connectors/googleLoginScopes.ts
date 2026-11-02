/** Client-safe: scopes asked for on "Continue with Google", so signing in also connects Gmail, Calendar and Drive. Keep in sync with SCOPES in google.ts. */
export const LOGIN_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");
export const LOGIN_QUERY = { access_type: "offline", prompt: "consent", include_granted_scopes: "true" };
