import { storePassword } from './password-store';

export interface DatabaseUrlInfo {
  url: string;
  redactedUrl: string;
  redactedId: string;
  password: string;
}

/**
 * Extract and process a database URL from a message
 */
export function extractDatabaseUrl(message: string): DatabaseUrlInfo | null {
  const dbUrlMatch = message.match(/(?:postgres|postgresql):\/\/[^@]+@[^\s]+/);
  if (!dbUrlMatch) return null;

  const url = dbUrlMatch[0];
  const urlObj = new URL(url);
  const password = urlObj.password;
  const redactedId = `redacted-${Math.random().toString(36).substring(2, 8)}`;

  // Create redacted URL
  urlObj.password = redactedId;

  return {
    url,
    redactedUrl: urlObj.toString(),
    redactedId,
    password,
  };
}

/**
 * Process a message containing a database URL
 */
export function processDatabaseUrl(
  message: string,
  chatId: string
): { message: string; dbUrl?: { redactedUrl: string; redactedId: string; password: string } } {
  const dbUrlInfo = extractDatabaseUrl(message);
  if (!dbUrlInfo) {
    return { message };
  }

  // Store the password in the browser
  storePassword(chatId, dbUrlInfo.password);

  // Replace the original URL with the redacted one in the message
  const redactedMessage = message.replace(dbUrlInfo.url, dbUrlInfo.redactedUrl);

  return {
    message: redactedMessage,
    dbUrl: {
      redactedUrl: dbUrlInfo.redactedUrl,
      redactedId: dbUrlInfo.redactedId,
      password: dbUrlInfo.password,
    },
  };
}
