export interface ChatMessage {
  id: string;
  chat_id: string;
  content: string;
  user_name: string;
  role: 'user' | 'agent';
  status: 'pending' | 'completed' | 'failed' | 'aborted';
  created_at: Date;
  dbUrl?: {
    redactedUrl: string;
    redactedId: string;
    password: string;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResponse {
  id: string;
  type: 'function';
  function: {
    name: string;
    content: string;
  };
}

export interface Chat {
  id: string;
  name: string;
  created_at: Date;
  messages: ChatMessage[];
}

export interface CreateChatRequest {
  message: string;
  user: string;
  id?: string; // Optional client-provided ID
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

export interface ToolHandler {
  name: string;
  getThinkingText: (args: unknown) => string;
  process: (
    args: unknown,
    chatId: string,
    messageId: string,
    dbUrlParam?: { redactedUrl: string; redactedId: string; password: string }
  ) => Promise<{
    content: string;
    systemMessage?: string;
    requiresReentry?: boolean;
  }>;
}
