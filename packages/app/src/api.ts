// Types
export interface ChatMessage {
  id: string;
  content: string;
  user_name: string;
  created_at: Date;
}

export interface Chat {
  id: string;
  created_at: Date;
  messages: ChatMessage[];
}

export interface CreateChatRequest {
  message: string;
  user: string;
  id?: string; // Client-provided UUID
}

export interface CreateMessageRequest {
  message: string;
  user: string;
}

// API client
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Create a new chat with an initial message
 */
export async function createChat(message: string, user: string, id?: string): Promise<Chat> {
  const payload: CreateChatRequest = { message, user, id };

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
  chatId: number | string,
  message: string,
  user: string
): Promise<ChatMessage> {
  const payload: CreateMessageRequest = { message, user };

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

  const data = await response.json();
  return data.message;
}
