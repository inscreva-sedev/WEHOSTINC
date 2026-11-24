import { WebmailMessage } from './webmailClient';

export const DEMO_EMAIL = 'teste@wehosthere.com';

export function isDemoAccount(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === DEMO_EMAIL;
}

export function getDemoMessages(_folder: string = 'inbox'): WebmailMessage[] {
  return [];
}
