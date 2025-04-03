import { Row } from '@electric-sql/client';
import { useShape, preloadShape } from '@electric-sql/react';
import { useEffect, useMemo, useRef } from 'react';
import { API_URL } from './api.js';

type ShapeOptions<T extends Row<unknown> = Row> = Parameters<typeof useShape<T>>[0];

interface MessageRow {
  [key: string]: unknown;
}

export function useShapeWithAbort<T extends Row<unknown>>(
  rawShapeConfig: ShapeOptions<T>,
  timeout: number
) {
  const key = JSON.stringify(rawShapeConfig);
  const storeRef = useRef<{
    controllers: Record<string, AbortController>;
    mounts: Record<string, number>;
    timeouts: Record<string, ReturnType<typeof setTimeout>>;
  }>({
    controllers: {},
    mounts: {},
    timeouts: {},
  });
  const store = storeRef.current;

  if (!store.controllers[key]) {
    store.controllers[key] = new AbortController();
  }

  const shapeConfig = useMemo(
    () => ({
      ...rawShapeConfig,
      signal: store.controllers[key].signal,
    }),
    [rawShapeConfig, store.controllers[key]]
  );

  useEffect(() => {
    // Increment mount count
    store.mounts[key] = (store.mounts[key] || 0) + 1;

    // Clear any pending timeout
    if (store.timeouts[key]) {
      clearTimeout(store.timeouts[key]);
      delete store.timeouts[key];
    }

    return () => {
      // Decrement mount count
      store.mounts[key] = Math.max(0, (store.mounts[key] || 0) - 1);

      // If fully unmounted, set abort timeout
      if (store.mounts[key] === 0) {
        store.timeouts[key] = setTimeout(() => {
          // Abort current controller and create new one
          store.controllers[key].abort();
          store.controllers[key] = new AbortController();
          delete store.timeouts[key];
        }, timeout);
      }
    };
  }, [key, timeout, store]);

  return useShape(shapeConfig);
}

// Chat Shape

export interface Chat extends MessageRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  pinned: boolean;
}

export function chatsShapeConfig(): ShapeOptions<Chat> {
  return {
    url: `${API_URL}/shape`,
    params: {
      table: 'chats',
    },
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
    signal: new AbortController().signal, // Dummy signal to ensure hashing is consistent
  };
}

export function useChatsShape() {
  return useShape(chatsShapeConfig());
}

export async function preloadChats() {
  await preloadShape<Chat>(chatsShapeConfig());
}

export function useChat(chatId: string) {
  const { data: chats } = useChatsShape();
  return chats.find(chat => chat.id === chatId);
}

// Message Shape

export interface Message extends MessageRow {
  id: string;
  chat_id: string;
  content: string;
  user_name: string;
  role: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  thinking_text: string;
}

export function messagesShapeConfig(chatId: string): ShapeOptions<Message> {
  return {
    url: `${API_URL}/shape`,
    params: {
      table: 'messages',
      where: `chat_id = '${chatId}'`,
    },
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
    signal: new AbortController().signal, // Dummy signal to ensure hashing is consistent
  };
}

export function useMessagesShape(chatId: string) {
  return useShapeWithAbort(messagesShapeConfig(chatId), 1000);
}

export async function preloadMessages(chatId: string) {
  await preloadShape<Message>(messagesShapeConfig(chatId));
}

// Token Shape

export interface Token extends MessageRow {
  message_id: string;
  token_number: number;
  token_text: string;
}

export function tokensShapeConfig(messageId: string): ShapeOptions<Token> {
  return {
    url: `${API_URL}/shape`,
    params: {
      table: 'tokens',
      where: `message_id = '${messageId}'`,
    },
    signal: new AbortController().signal, // Dummy signal to ensure hashing is consistent
  };
}

export function useTokensShape(messageId: string) {
  return useShapeWithAbort(tokensShapeConfig(messageId), 1000);
}

// File Shape

export interface File extends MessageRow {
  id: string;
  chat_id: string;
  path: string;
  mime_type: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export function filesShapeConfig(chatId: string): ShapeOptions<File> {
  return {
    url: `${API_URL}/shape`,
    params: {
      table: 'files',
      where: `chat_id = '${chatId}'`,
    },
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
    signal: new AbortController().signal, // Dummy signal to ensure hashing is consistent
  };
}

export function useFilesShape(chatId: string) {
  return useShapeWithAbort(filesShapeConfig(chatId), 1000);
}

export async function preloadFiles(chatId: string) {
  await preloadShape<File>(filesShapeConfig(chatId));
}

// Todo List Shape

export interface TodoList extends MessageRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export function todoListsShapeConfig(): ShapeOptions<TodoList> {
  return {
    url: `${API_URL}/shape`,
    params: {
      table: 'todo_lists',
    },
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
    signal: new AbortController().signal, // Dummy signal to ensure hashing is consistent
  };
}

export function useTodoListsShape() {
  return useShape(todoListsShapeConfig());
}

export async function preloadTodoLists() {
  await preloadShape<TodoList>(todoListsShapeConfig());
}

export function useTodoList(listId: string) {
  const { data: lists } = useTodoListsShape();
  return lists.find(list => list.id === listId);
}

// Todo Item Shape

export interface TodoItem extends MessageRow {
  id: string;
  list_id: string;
  task: string;
  done: boolean;
  order_key: string;
  created_at: Date;
  updated_at: Date;
}

export function todoItemsShapeConfig(listId: string): ShapeOptions<TodoItem> {
  return {
    url: `${API_URL}/shape`,
    params: {
      table: 'todo_items',
      where: `list_id = '${listId}'`,
    },
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
    signal: new AbortController().signal, // Dummy signal to ensure hashing is consistent
  };
}

export function useTodoItemsShape(listId: string) {
  return useShapeWithAbort(todoItemsShapeConfig(listId), 1000);
}

export async function preloadTodoItems(listId: string) {
  await preloadShape<TodoItem>(todoItemsShapeConfig(listId));
}

// User Presence Shape

export interface UserPresence extends MessageRow {
  id: string;
  chat_id: string;
  user_name: string;
  last_seen: Date;
  typing: boolean;
  created_at: Date;
}

export function presenceShapeConfig(chatId: string): ShapeOptions<UserPresence> {
  return {
    url: `${API_URL}/shape`,
    params: {
      table: 'user_presence',
      where: `chat_id = '${chatId}'`,
    },
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
    signal: new AbortController().signal, // Dummy signal to ensure hashing is consistent
  };
}

export function usePresenceShape(chatId: string) {
  return useShapeWithAbort(presenceShapeConfig(chatId), 1000);
}
