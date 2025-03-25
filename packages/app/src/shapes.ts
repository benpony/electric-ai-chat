import { Row } from "@electric-sql/client";
import { useShape, preloadShape } from "@electric-sql/react";

const ELECTRIC_API_URL = import.meta.env.VITE_ELECTRIC_API_URL || "http://localhost:3000";

type ShapeOptions<T extends Row<unknown> = Row> = Parameters<
  typeof useShape<T>
>[0]

interface MessageRow {
  [key: string]: unknown;
}

// Chat Shape

export interface Chat extends MessageRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export function chatsShapeConfig(): ShapeOptions<Chat> {
  return {
    url: `${ELECTRIC_API_URL}/v1/shape`,
    params: {
      table: "chats",
    },
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
  };
}

export function useChatsShape() {
  return useShape(chatsShapeConfig());
};

export async function preloadChats() {
  await preloadShape({
    url: `${ELECTRIC_API_URL}/v1/shape`,
    params: {
      table: "chats",
    },
  });
}

export function useChat(chatId: string) {
  const { data: chats } = useChatsShape();
  return chats.find((chat) => chat.id === chatId);
}

// Message Shape

export interface Message extends MessageRow {
  id: string;
  chat_id: string;
  content: string;
  user_name: string;
  role: string;
  status: string;
}

export function messagesShapeConfig(chatId: string): ShapeOptions<Message> {
  return {
    url: `${ELECTRIC_API_URL}/v1/shape`,
    params: {
      table: "messages",
      where: `chat_id = '${chatId}'`,
    },
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
  };
}

export function useMessagesShape(chatId: string) {
  return useShape(messagesShapeConfig(chatId));
}

// Token Shape

export interface Token extends MessageRow {
  message_id: string;
  token_number: number;
  token_text: string;
}

export function tokensShapeConfig(messageId: string): ShapeOptions<Token> {
  return {
    url: `${ELECTRIC_API_URL}/v1/shape`,
    params: {
      table: "tokens",
      where: `message_id = '${messageId}'`,
    },
  };
}

export function useTokensShape(messageId: string) {
  return useShape(tokensShapeConfig(messageId));
}
