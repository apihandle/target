export function validateCredentials(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Please enter a valid email.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}
