import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { proxy } from 'hono/proxy';
import type { Context } from 'hono';
import { randomUUID } from 'crypto';
import { db } from './db.js';
import { rowToChatMessage } from './utils.js';
import { Chat, CreateChatRequest, CreateMessageRequest, UpdatePresenceRequest } from './types.js';
import { createAIResponse, generateChatName, ENABLE_AI } from './ai/index.js';

// Access the Electric API URL
const ELECTRIC_API_URL = process.env.ELECTRIC_API_URL || 'http://localhost:3000';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

const app = new Hono();

// Enable CORS
app.use(
  '/*',
  cors({
    origin: [
      FRONTEND_ORIGIN,
      'http://localhost:5173',
      'https://localhost:5173',
      'http://localhost:3000',
      'https://localhost:3000',
      'http://localhost:3001',
      'https://localhost:3001',
      'http://localhost:3002',
      'https://localhost:3002',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: [
      'Content-Length',
      'X-Kuma-Revision',
      'electric-offset',
      'electric-handle',
      'electric-schema',
      'electric-cursor',
      'electric-up-to-date',
    ],
    maxAge: 600,
    credentials: true,
  })
);

app.get('/test', async c => {
  console.log('Hello, world!');
  return c.json({ message: 'Hello, world!' });
});

// Proxy endpoint for Electric shape API
app.get('/shape', async c => {
  // This is where you can perform any custom authentication of your shapes.
  const request = c.req.raw;
  const originUrl = new URL(`${ELECTRIC_API_URL}/v1/shape`);

  const url = new URL(request.url);
  url.searchParams.forEach((value, key) => {
    originUrl.searchParams.set(key, value);
  });

  const response = await proxy(originUrl.toString(), {
    ...request,
    headers: {
      ...request.headers,
    },
  });

  return response;
});

// Get chat messages
app.get('/chats/:id', async (c: Context) => {
  const chatId = c.req.param('id');

  try {
    // Get chat details
    const [chat] = await db`
      SELECT id, name, created_at
      FROM chats
      WHERE id = ${chatId}
    `;

    if (!chat) {
      return c.json({ error: 'Chat not found' }, 404);
    }

    // Get all messages for this chat
    const messages = await db`
      SELECT id, content, user_name, role, status, created_at
      FROM messages
      WHERE chat_id = ${chatId}
      ORDER BY created_at ASC
    `;

    // Convert to proper type
    const typedMessages = messages.map(rowToChatMessage);

    return c.json({ chat: { ...chat, messages: typedMessages } });
  } catch (err) {
    console.error('Error fetching chat:', err);
    return c.json({ error: 'Failed to fetch chat' }, 500);
  }
});

// Create a new chat
app.post('/chats', async (c: Context) => {
  const body = await c.req.json();
  const { message, user, id, dbUrl } = body as CreateChatRequest;

  if (!message || !user) {
    return c.json({ error: 'Message and user are required' }, 400);
  }

  try {
    // Extract chat name from first message (limit to 120 characters)
    const chatName = message.slice(0, 120);

    // Use client-provided ID or generate one
    const chatId = id || randomUUID();

    // Insert new chat and first message
    const chat = await db.begin(async sql => {
      // Create chat
      const [newChat] = await sql`
        INSERT INTO chats (id, name, created_at)
        VALUES (${chatId}, ${chatName}, NOW())
        RETURNING id, name, created_at
      `;

      // Generate UUID for the message
      const messageId = randomUUID();

      // Add first message to chat
      const [newMessage] = await sql`
        INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at)
        VALUES (${messageId}, ${chatId}, ${message}, ${user}, 'user', 'completed', NOW())
        RETURNING id, content, user_name, role, status, created_at
      `;

      return { ...newChat, messages: [rowToChatMessage(newMessage)] } as Chat;
    });

    if (!ENABLE_AI) {
      return c.json({ chat }, 201);
    }

    // Asynchronously generate a better name for the chat and update it
    // This happens after we've already responded to the client
    generateChatName(message)
      .then(async (generatedName: string | null) => {
        if (generatedName) {
          try {
            await db`
              UPDATE chats
              SET name = ${generatedName}
              WHERE id = ${chatId}
            `;
            console.log(`Updated chat ${chatId} name to: ${generatedName}`);
          } catch (updateErr) {
            console.error('Error updating chat name:', updateErr);
          }
        }
      })
      .catch((err: Error) => {
        console.error('Error in chat name generation process:', err);
      });

    // Trigger AI response
    const messages = await db`
      SELECT id, content, user_name, role, status, created_at
      FROM messages
      WHERE chat_id = ${chatId}
      ORDER BY created_at ASC
    `;

    // Make sure dbUrl has the password field required by createAIResponse
    const aiMessage = await createAIResponse({
      chatId,
      contextRows: messages,
      dbUrl,
    });

    // Include the pending AI message in the response
    chat.messages.push(aiMessage);

    return c.json({ chat }, 201);
  } catch (err) {
    console.error('Error creating chat:', err);
    return c.json({ error: 'Failed to create chat' }, 500);
  }
});

// Add message to existing chat
app.post('/chats/:id/messages', async (c: Context) => {
  const chatId = c.req.param('id');
  const body = await c.req.json();
  const { message, user, dbUrl, attachment } = body as CreateMessageRequest;

  if (!message || !user) {
    return c.json({ error: 'Message and user are required' }, 400);
  }

  try {
    // Use a transaction to ensure atomic operations
    const result = await db.begin(async sql => {
      // Verify chat exists
      const [chat] = await sql`
        SELECT id FROM chats WHERE id = ${chatId}
      `;

      if (!chat) {
        return { error: 'Chat not found', status: 404 };
      }

      // Get all messages for context before aborting pending messages
      const rawMessages = await sql`
        SELECT 
          m.id, 
          CASE 
            WHEN m.status = 'pending' AND tokens_content IS NOT NULL THEN tokens_content
            ELSE m.content
          END as content,
          m.user_name, 
          m.role, 
          m.status, 
          m.created_at, 
          m.updated_at,
          m.attachment
        FROM messages m
        LEFT JOIN LATERAL (
          SELECT string_agg(token_text, '') as tokens_content
          FROM tokens 
          WHERE message_id = m.id
          GROUP BY message_id
        ) t ON m.status = 'pending'
        WHERE m.chat_id = ${chatId}
        ORDER BY m.created_at ASC
      `;

      // Abort any pending messages in this chat
      await sql`
        UPDATE messages
        SET status = 'aborted'
        WHERE chat_id = ${chatId}
        AND status = 'pending'
      `;

      // Generate UUID for the message
      const messageId = randomUUID();

      // Add user message to chat
      const [newMessage] = await sql`
        INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at, attachment)
        VALUES (${messageId}, ${chatId}, ${message}, ${user}, 'user', 'completed', NOW(), ${attachment || null})
        RETURNING id, content, user_name, role, status, created_at, attachment
      `;

      return { newMessage, rawMessages };
    });

    // Handle transaction result
    if (result.error) {
      return c.json({ error: result.error }, result.status as any);
    }

    // If AI is disabled, return the user message only
    if (!ENABLE_AI) {
      return c.json(
        {
          messages: [rowToChatMessage(result.newMessage)],
        },
        201
      );
    }

    // Sort messages for proper context
    const messages = result.rawMessages!.sort((a, b) => {
      // If both messages are from agent, compare by updated_at
      if (a.role === 'agent' && b.role === 'agent') {
        const timeA = a.updated_at.getTime();
        const timeB = b.updated_at.getTime();
        if (timeA === timeB) {
          // If timestamps equal, pending messages come after non-pending
          if (a.status === 'pending' && b.status !== 'pending') return 1;
          if (a.status !== 'pending' && b.status === 'pending') return -1;
        }
        return timeA - timeB;
      }
      // Otherwise compare by created_at
      return a.created_at.getTime() - b.created_at.getTime();
    });

    // Add the newly created user message to the message list
    messages.push(result.newMessage!);

    // Create AI response (will create a pending message and process in background)
    const aiMessage = await createAIResponse({
      chatId,
      contextRows: messages,
      dbUrl,
    });

    // Return both the user message and the pending AI message
    return c.json(
      {
        messages: [rowToChatMessage(result.newMessage!), aiMessage],
      },
      201
    );
  } catch (err) {
    console.error('Error adding message:', err);
    return c.json({ error: 'Failed to add message' }, 500);
  }
});

// Abort an in-progress message
app.post('/messages/:id/abort', async (c: Context) => {
  const messageId = c.req.param('id');

  try {
    // Use a transaction to check the message status and update it atomically
    const result = await db.begin(async sql => {
      // Check if message exists and is in pending state
      const [message] = await sql`
        SELECT id, status FROM messages WHERE id = ${messageId}
      `;

      if (!message) {
        return { error: 'Message not found', status: 404 };
      }

      if (message.status !== 'pending') {
        return { error: 'Only pending messages can be aborted', status: 400 };
      }

      // Update message status to aborted
      await sql`
        UPDATE messages
        SET status = 'aborted'
        WHERE id = ${messageId}
      `;

      return { success: true };
    });

    // Handle transaction result
    if (result.error) {
      return c.json({ error: result.error }, result.status as any);
    }

    return c.json(result);
  } catch (err) {
    console.error('Error aborting message:', err);
    return c.json({ error: 'Failed to abort message' }, 500);
  }
});

// Pin/Unpin a chat
app.post('/chats/:id/pin', async (c: Context) => {
  const chatId = c.req.param('id');
  const body = await c.req.json();
  const { pinned } = body as { pinned: boolean };

  if (typeof pinned !== 'boolean') {
    return c.json({ error: 'pinned must be a boolean' }, 400);
  }

  try {
    // Verify chat exists
    const [chat] = await db`
      SELECT id FROM chats WHERE id = ${chatId}
    `;

    if (!chat) {
      return c.json({ error: 'Chat not found' }, 404);
    }

    // Update chat pinned status
    await db`
      UPDATE chats
      SET pinned = ${pinned}
      WHERE id = ${chatId}
    `;

    return c.json({ success: true });
  } catch (err) {
    console.error('Error updating chat pin status:', err);
    return c.json({ error: 'Failed to update chat pin status' }, 500);
  }
});

// Delete a chat and all related data
app.delete('/chats/:id', async (c: Context) => {
  const chatId = c.req.param('id');

  try {
    // Check if chat exists
    const [chat] = await db`
      SELECT id FROM chats WHERE id = ${chatId}
    `;

    if (!chat) {
      return c.json({ error: 'Chat not found' }, 404);
    }

    // Delete the chat (cascade will delete all related data)
    await db`
      DELETE FROM chats
      WHERE id = ${chatId}
    `;

    return c.json({ success: true });
  } catch (err) {
    console.error('Error deleting chat:', err);
    return c.json({ error: 'Failed to delete chat' }, 500);
  }
});

// Todo List Routes

// Get all todo lists
app.get('/todo-lists', async (c: Context) => {
  try {
    const lists = await db`
      SELECT id, name, created_at, updated_at
      FROM todo_lists
      ORDER BY created_at DESC
    `;

    return c.json({ todoLists: lists });
  } catch (err) {
    console.error('Error fetching todo lists:', err);
    return c.json({ error: 'Failed to fetch todo lists' }, 500);
  }
});

// Create a new todo list
app.post('/todo-lists', async (c: Context) => {
  const body = await c.req.json();
  const { name, id } = body as { name: string; id?: string };

  if (!name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  try {
    // Use provided ID or generate a new one
    const listId = id || randomUUID();

    const [todoList] = await db`
      INSERT INTO todo_lists (id, name, created_at, updated_at)
      VALUES (${listId}, ${name}, NOW(), NOW())
      RETURNING id, name, created_at, updated_at
    `;

    return c.json({ todoList }, 201);
  } catch (err) {
    console.error('Error creating todo list:', err);
    return c.json({ error: 'Failed to create todo list' }, 500);
  }
});

// Get a specific todo list with items
app.get('/todo-lists/:id', async (c: Context) => {
  const listId = c.req.param('id');

  try {
    // Get list details
    const [list] = await db`
      SELECT id, name, created_at, updated_at
      FROM todo_lists
      WHERE id = ${listId}
    `;

    if (!list) {
      return c.json({ error: 'Todo list not found' }, 404);
    }

    // Get all items for this list
    const items = await db`
      SELECT id, list_id, task, done, order_key, created_at, updated_at
      FROM todo_items
      WHERE list_id = ${listId}
      ORDER BY order_key ASC
    `;

    return c.json({ todoList: { ...list, items } });
  } catch (err) {
    console.error('Error fetching todo list:', err);
    return c.json({ error: 'Failed to fetch todo list' }, 500);
  }
});

// Delete a todo list
app.delete('/todo-lists/:id', async (c: Context) => {
  const listId = c.req.param('id');

  try {
    // Check if list exists
    const [list] = await db`
      SELECT id FROM todo_lists WHERE id = ${listId}
    `;

    if (!list) {
      return c.json({ error: 'Todo list not found' }, 404);
    }

    // Delete the list (cascade will delete items)
    await db`
      DELETE FROM todo_lists
      WHERE id = ${listId}
    `;

    return c.json({ success: true });
  } catch (err) {
    console.error('Error deleting todo list:', err);
    return c.json({ error: 'Failed to delete todo list' }, 500);
  }
});

// Todo Item Routes

// Create a new todo item
app.post('/todo-lists/:listId/items', async (c: Context) => {
  const listId = c.req.param('listId');
  const body = await c.req.json();
  const { task, order_key } = body as { task: string; order_key: string };

  if (!task) {
    return c.json({ error: 'Task is required' }, 400);
  }

  if (!order_key) {
    return c.json({ error: 'order_key is required' }, 400);
  }

  try {
    // Check if list exists
    const [list] = await db`
      SELECT id FROM todo_lists WHERE id = ${listId}
    `;

    if (!list) {
      return c.json({ error: 'Todo list not found' }, 404);
    }

    const itemId = randomUUID();

    const [todoItem] = await db`
      INSERT INTO todo_items (id, list_id, task, done, order_key, created_at, updated_at)
      VALUES (${itemId}, ${listId}, ${task}, false, ${order_key}, NOW(), NOW())
      RETURNING id, list_id, task, done, order_key, created_at, updated_at
    `;

    return c.json({ todoItem }, 201);
  } catch (err) {
    console.error('Error creating todo item:', err);
    return c.json({ error: 'Failed to create todo item' }, 500);
  }
});

// Update a todo item
app.patch('/todo-items/:id', async (c: Context) => {
  const itemId = c.req.param('id');
  const body = await c.req.json();
  const updates = body as { task?: string; done?: boolean; order_key?: string };

  // Make sure there's at least one valid field to update
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  try {
    // Check if item exists and get current values
    const [item] = await db`
      SELECT id, task, done, order_key, updated_at 
      FROM todo_items 
      WHERE id = ${itemId}
    `;

    if (!item) {
      return c.json({ error: 'Todo item not found' }, 404);
    }

    // Log the update
    console.log(`Updating item ${itemId}:`, updates);

    // Use a transaction to ensure atomic update
    const updatedItem = await db.begin(async sql => {
      if (updates.task !== undefined) {
        await sql`
          UPDATE todo_items
          SET task = ${updates.task}, updated_at = NOW()
          WHERE id = ${itemId}
        `;
      }

      if (updates.done !== undefined) {
        await sql`
          UPDATE todo_items
          SET done = ${updates.done}, updated_at = NOW()
          WHERE id = ${itemId}
        `;
      }

      if (updates.order_key !== undefined) {
        await sql`
          UPDATE todo_items
          SET order_key = ${updates.order_key}, updated_at = NOW()
          WHERE id = ${itemId}
        `;
      }

      // Return the updated item
      const result = await sql`
        SELECT id, list_id, task, done, order_key, created_at, updated_at
        FROM todo_items
        WHERE id = ${itemId}
      `;

      return result[0];
    });

    return c.json({ todoItem: updatedItem });
  } catch (err) {
    console.error('Error updating todo item:', err);
    return c.json({ error: 'Failed to update todo item' }, 500);
  }
});

// Delete a todo item
app.delete('/todo-items/:id', async (c: Context) => {
  const itemId = c.req.param('id');

  try {
    // Check if item exists
    const [item] = await db`
      SELECT id FROM todo_items WHERE id = ${itemId}
    `;

    if (!item) {
      return c.json({ error: 'Todo item not found' }, 404);
    }

    // Delete the item
    await db`
      DELETE FROM todo_items
      WHERE id = ${itemId}
    `;

    return c.json({ success: true });
  } catch (err) {
    console.error('Error deleting todo item:', err);
    return c.json({ error: 'Failed to delete todo item' }, 500);
  }
});

// Update user presence in a chat
app.post('/chats/:id/presence', async (c: Context) => {
  const chatId = c.req.param('id');
  const body = await c.req.json();
  const { user_name, typing } = body as UpdatePresenceRequest;

  if (!user_name) {
    return c.json({ error: 'User name is required' }, 400);
  }

  try {
    // Upsert user presence
    const [presence] =
      typing === undefined
        ? await db`
          INSERT INTO user_presence (id, chat_id, user_name, last_seen)
          VALUES (${randomUUID()}, ${chatId}, ${user_name}, NOW())
          ON CONFLICT (chat_id, user_name)
          DO UPDATE SET
            last_seen = NOW()
          RETURNING id, chat_id, user_name, last_seen, typing, created_at
        `
        : await db`
          INSERT INTO user_presence (id, chat_id, user_name, last_seen, typing)
          VALUES (${randomUUID()}, ${chatId}, ${user_name}, NOW(), ${typing})
          ON CONFLICT (chat_id, user_name)
          DO UPDATE SET
            last_seen = NOW(),
            typing = ${typing}
          RETURNING id, chat_id, user_name, last_seen, typing, created_at
        `;

    // Clean up stale presence records (older than 20 seconds)
    await db`
      DELETE FROM user_presence
      WHERE last_seen < NOW() - INTERVAL '20 seconds'
    `;

    return c.json({ presence });
  } catch (err) {
    console.error('Error updating presence:', err);
    return c.json({ error: 'Failed to update presence' }, 500);
  }
});

// Get active users in a chat (for debugging)
app.get('/chats/:id/presence', async (c: Context) => {
  const chatId = c.req.param('id');

  try {
    const presences = await db`
      SELECT id, chat_id, user_name, last_seen, typing, created_at
      FROM user_presence
      WHERE chat_id = ${chatId}
      AND last_seen > NOW() - INTERVAL '20 seconds'
      ORDER BY user_name
    `;

    return c.json({ presences });
  } catch (err) {
    console.error('Error fetching presence:', err);
    return c.json({ error: 'Failed to fetch presence' }, 500);
  }
});

// Delete a user's presence from a chat
app.delete('/chats/:id/presence/:userName', async (c: Context) => {
  const chatId = c.req.param('id');
  const userName = c.req.param('userName');

  try {
    // Delete the presence record
    await db`
      DELETE FROM user_presence
      WHERE chat_id = ${chatId}
      AND user_name = ${userName}
    `;

    return c.json({ success: true });
  } catch (err) {
    console.error('Error removing presence:', err);
    return c.json({ error: 'Failed to remove presence' }, 500);
  }
});

// Start server
const port = parseInt(process.env.PORT || '3001', 10);
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
