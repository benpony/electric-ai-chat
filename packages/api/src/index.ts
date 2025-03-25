import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import type { Context } from 'hono';
import { db } from './db.js';
import { randomUUID } from 'crypto';

// Define types
interface ChatMessage {
  id: string;
  content: string;
  user_name: string;
  created_at: Date;
}

interface Chat {
  id: string;
  name: string;
  created_at: Date;
  messages: ChatMessage[];
}

interface CreateChatRequest {
  message: string;
  user: string;
}

interface CreateMessageRequest {
  message: string;
  user: string;
}

const app = new Hono();

// Enable CORS
app.use('/*', cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
  maxAge: 600,
  credentials: true,
}));

// Create a new chat
app.post('/api/chats', async (c: Context) => {
  const body = await c.req.json();
  const { message, user } = body as CreateChatRequest;
  
  if (!message || !user) {
    return c.json({ error: 'Message and user are required' }, 400);
  }

  try {
    // Extract chat name from first message (limit to 120 characters)
    const chatName = message.slice(0, 120);
    
    // Generate UUID for the chat
    const chatId = randomUUID();
    
    // Insert new chat and first message
    const chat = await db.begin(async (sql) => {
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
        INSERT INTO messages (id, chat_id, content, user_name, created_at)
        VALUES (${messageId}, ${chatId}, ${message}, ${user}, NOW())
        RETURNING id, content, user_name, created_at
      `;
      
      return { ...newChat, messages: [newMessage] } as Chat;
    });
    
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
    
    // Add message to chat
    const [newMessage] = await db`
      INSERT INTO messages (id, chat_id, content, user_name, created_at)
      VALUES (${messageId}, ${chatId}, ${message}, ${user}, NOW())
      RETURNING id, content, user_name, created_at
    `;
    
    return c.json({ message: newMessage }, 201);
  } catch (err) {
    console.error('Error adding message:', err);
    return c.json({ error: 'Failed to add message' }, 500);
  }
});

// Start server
const port = parseInt(process.env.PORT || '3001', 10);
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port
}); 