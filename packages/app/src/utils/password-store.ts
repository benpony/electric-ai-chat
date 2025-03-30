// Type for the password store structure
type PasswordStore = Map<string, Map<string, string>>;

// Singleton instance of the password store
const passwordStore: PasswordStore = new Map();

/**
 * Generate a unique redacted ID
 */
export function generateRedactedId(): string {
  return `redacted-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Store a password for a chat
 */
export function storePassword(chatId: string, password: string): string {
  const redactedId = generateRedactedId();

  // Get or create the chat's password map
  let chatPasswords = passwordStore.get(chatId);
  if (!chatPasswords) {
    chatPasswords = new Map();
    passwordStore.set(chatId, chatPasswords);
  }

  // Store the password
  chatPasswords.set(redactedId, password);

  return redactedId;
}

/**
 * Get all passwords for a chat
 */
export function getChatPasswords(chatId: string): Map<string, string> {
  return passwordStore.get(chatId) || new Map();
}

/**
 * Get a specific password by redacted ID
 */
export function getPassword(chatId: string, redactedId: string): string | undefined {
  const chatPasswords = passwordStore.get(chatId);
  return chatPasswords?.get(redactedId);
}

/**
 * Clear all passwords for a chat
 */
export function clearChatPasswords(chatId: string): void {
  passwordStore.delete(chatId);
}
