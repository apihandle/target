/** Client-safe: scopes asked for on "Continue with Google", so signing in also connects Google (Gmail, Calendar, Drive, Contacts). Keep in sync with SCOPES in google/shared.ts. */
export const LOGIN_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
].join(" ");
export const LOGIN_QUERY = { access_type: "offline", prompt: "consent", include_granted_scopes: "true" };
