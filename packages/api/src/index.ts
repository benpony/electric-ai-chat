import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import type { Context } from 'hono';
import { randomUUID } from 'crypto';
import { db } from './db.js';
import { rowToChatMessage } from './utils.js';
import { Chat, CreateChatRequest, CreateMessageRequest } from './types.js';
import { createAIResponse, generateChatName, ENABLE_AI } from './ai.js';

const app = new Hono();

// Enable CORS
app.use(
  '/*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
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
  const { message, user, id } = body as CreateChatRequest;

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
      .then(async generatedName => {
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
      .catch(err => {
        console.error('Error in chat name generation process:', err);
      });

    // Trigger AI response
    const messages = await db`
      SELECT id, content, user_name, role, status, created_at
      FROM messages
      WHERE chat_id = ${chatId}
      ORDER BY created_at ASC
    `;

    const aiMessage = await createAIResponse(chatId, messages);

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
  const { message, user } = body as CreateMessageRequest;

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
    const aiMessage = await createAIResponse(chatId, messages);

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

// Start server
const port = parseInt(process.env.PORT || '3001', 10);
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
