// Types
export interface ChatMessage {
  id: string;
  content: string;
  user_name: string;
  created_at: Date;
  role?: 'user' | 'agent';
  status?: 'pending' | 'completed' | 'failed' | 'aborted';
}

export interface Chat {
  id: string;
  created_at: Date;
  messages: ChatMessage[];
}

export interface CreateChatRequest {
  message: string;
  user: string;
  id?: string;
  dbUrl?: {
    redactedUrl: string;
    redactedId: string;
    password: string;
  };
}

export interface CreateMessageRequest {
  message: string;
  user: string;
  dbUrl?: {
    redactedUrl: string;
    redactedId: string;
    password: string;
  };
}

// API client
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Create a new chat with an initial message
 */
export async function createChat(
  message: string,
  user: string,
  id?: string,
  dbUrl?: { redactedUrl: string; redactedId: string; password: string }
): Promise<Chat> {
  const payload: CreateChatRequest = { message, user, id, dbUrl };

  const response = await fetch(`${API_URL}/api/chats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create chat');
  }

  const data = await response.json();
  return data.chat;
}

/**
 * Add a message to an existing chat
 */
export async function addMessage(
  chatId: string,
  message: string,
  user: string,
  dbUrl?: { redactedUrl: string; redactedId: string; password: string }
): Promise<{ messages: ChatMessage[] }> {
  const payload: CreateMessageRequest = { message, user, dbUrl };

  const response = await fetch(`${API_URL}/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add message');
  }

  return response.json();
}

/**
 * Abort an in-progress AI message
 */
export async function abortMessage(messageId: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_URL}/api/messages/${messageId}/abort`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to abort message');
  }

  return response.json();
}
