import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import type { Context } from 'hono';
import { db } from './db.js';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

// Define types
interface ChatMessage {
  id: string;
  content: string;
  user_name: string;
  created_at: Date;
  role?: 'user' | 'agent';
  status?: 'pending' | 'completed' | 'failed';
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

// Helper to convert database rows to ChatMessage objects
function rowToChatMessage(row: any): ChatMessage {
  return {
    id: row.id,
    content: row.content,
    user_name: row.user_name,
    created_at: row.created_at,
    role: row.role,
    status: row.status
  };
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

// Helper function to create AI response
async function createAIResponse(chatId: string, contextRows: any[]) {
  try {
    // Convert rows to ChatMessage objects
    const context = contextRows.map(rowToChatMessage);
    
    // Create a pending AI message
    const messageId = randomUUID();
    
    // Insert pending message
    await db`
      INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at)
      VALUES (${messageId}, ${chatId}, '', 'AI Assistant', 'agent', 'pending', NOW())
    `;
    
    // Start streaming in background
    processAIStream(chatId, messageId, context).catch(error => {
      console.error('Error in AI streaming:', error);
      // Update message to failed status if there's an error
      db`
        UPDATE messages
        SET status = 'failed', content = 'Failed to generate response'
        WHERE id = ${messageId}
      `.catch(err => console.error('Error updating failed message:', err));
    });
    
    // Immediately return the pending message
    const [pendingMessage] = await db`
      SELECT id, content, user_name, role, status, created_at
      FROM messages
      WHERE id = ${messageId}
    `;
    
    return rowToChatMessage(pendingMessage);
  } catch (err) {
    console.error('Error creating AI response:', err);
    throw err;
  }
}

// Process AI stream in background
async function processAIStream(chatId: string, messageId: string, context: ChatMessage[]) {
  // Convert chat history to OpenAI format
  const messages: ChatCompletionMessageParam[] = context.map(msg => ({
    role: msg.role === 'agent' ? 'assistant' : 'user',
    content: msg.content,
  }));
  
  // Call OpenAI with streaming
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    stream: true,
  });
  
  let tokenNumber = 0;
  let fullContent = '';
  
  // Process each chunk as it arrives
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      fullContent += content;
      
      // Store token in the tokens table
      await db`
        INSERT INTO tokens (message_id, token_number, token_text)
        VALUES (${messageId}, ${tokenNumber}, ${content})
      `;
      
      tokenNumber++;
    }
  }
  
  // Update the message with the complete content
  await db`
    UPDATE messages
    SET content = ${fullContent}, status = 'completed'
    WHERE id = ${messageId}
  `;
  
  // Wait 1 second, then delete tokens
  setTimeout(async () => {
    try {
      await db`DELETE FROM tokens WHERE message_id = ${messageId}`;
    } catch (err) {
      console.error('Error deleting tokens:', err);
    }
  }, 1000);
}

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
        INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at)
        VALUES (${messageId}, ${chatId}, ${message}, ${user}, 'user', 'completed', NOW())
        RETURNING id, content, user_name, role, status, created_at
      `;
      
      return { ...newChat, messages: [rowToChatMessage(newMessage)] } as Chat;
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
    return c.json({ 
      messages: [rowToChatMessage(newMessage), aiMessage]
    }, 201);
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