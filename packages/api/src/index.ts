import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import type { Context } from 'hono';
import { randomUUID } from 'crypto';
import { db } from './db.js';
import { rowToChatMessage } from './utils.js';
import { Chat, CreateChatRequest, CreateMessageRequest } from './types.js';
import { createAIResponse, generateChatName, ENABLE_AI } from './ai/index.js';

const app = new Hono();

// Enable CORS
app.use(
  '/*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
    maxAge: 600,
    credentials: true,
  })
);

// Get chat messages
app.get('/api/chats/:id', async (c: Context) => {
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
app.post('/api/chats', async (c: Context) => {
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
    const aiMessage = await createAIResponse(chatId, messages, dbUrl);

    // Include the pending AI message in the response
    chat.messages.push(aiMessage);

    return c.json({ chat }, 201);
  } catch (err) {
    console.error('Error creating chat:', err);
    return c.json({ error: 'Failed to create chat' }, 500);
  }
});

// Add message to existing chat
app.post('/api/chats/:id/messages', async (c: Context) => {
  const chatId = c.req.param('id');
  const body = await c.req.json();
  const { message, user, dbUrl } = body as CreateMessageRequest;

  if (!message || !user) {
    return c.json({ error: 'Message and user are required' }, 400);
  }

  try {
    // Verify chat exists
    const [chat] = await db`
      SELECT id FROM chats WHERE id = ${chatId}
    `;

    if (!chat) {
      return c.json({ error: 'Chat not found' }, 404);
    }

    // Generate UUID for the message
    const messageId = randomUUID();

    // Add user message to chat
    const [newMessage] = await db`
      INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at)
      VALUES (${messageId}, ${chatId}, ${message}, ${user}, 'user', 'completed', NOW())
      RETURNING id, content, user_name, role, status, created_at
    `;

    // If AI is disabled, return the user message only
    if (!ENABLE_AI) {
      return c.json(
        {
          messages: [rowToChatMessage(newMessage)],
        },
        201
      );
    }

    // Get all messages for context
    const messages = await db`
      SELECT id, content, user_name, role, status, created_at
      FROM messages
      WHERE chat_id = ${chatId}
      ORDER BY created_at ASC
    `;

    // Create AI response (will create a pending message and process in background)
    const aiMessage = await createAIResponse(chatId, messages, dbUrl);

    // Return both the user message and the pending AI message
    return c.json(
      {
        messages: [rowToChatMessage(newMessage), aiMessage],
      },
      201
    );
  } catch (err) {
    console.error('Error adding message:', err);
    return c.json({ error: 'Failed to add message' }, 500);
  }
});

// Abort an in-progress message
app.post('/api/messages/:id/abort', async (c: Context) => {
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
      return c.json({ error: result.error }, result.status);
    }

    return c.json(result);
  } catch (err) {
    console.error('Error aborting message:', err);
    return c.json({ error: 'Failed to abort message' }, 500);
  }
});

// Pin/Unpin a chat
app.post('/api/chats/:id/pin', async (c: Context) => {
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

// Todo List Routes

// Get all todo lists
app.get('/api/todo-lists', async (c: Context) => {
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
app.post('/api/todo-lists', async (c: Context) => {
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
app.get('/api/todo-lists/:id', async (c: Context) => {
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
app.delete('/api/todo-lists/:id', async (c: Context) => {
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
app.post('/api/todo-lists/:listId/items', async (c: Context) => {
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
app.patch('/api/todo-items/:id', async (c: Context) => {
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
    const updatedItem = await db.begin(async (sql) => {
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
app.delete('/api/todo-items/:id', async (c: Context) => {
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

// Start server
const port = parseInt(process.env.PORT || '3001', 10);
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
