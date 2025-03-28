import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import type { Context } from 'hono';
import { db } from './db.js';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Shape, ShapeStream } from '@electric-sql/client';

const ENABLE_AI = true;
const ELECTRIC_API_URL = process.env.ELECTRIC_API_URL || 'http://localhost:3000';

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

interface ChatMessage {
  id: string;
  content: string;
  user_name: string;
  created_at: Date;
  role?: 'user' | 'agent';
  status?: 'pending' | 'completed' | 'failed';
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ToolResponse {
  id: string;
  type: 'function';
  function: {
    name: string;
    content: string;
  };
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
  id?: string; // Optional client-provided ID
}

interface CreateMessageRequest {
  message: string;
  user: string;
}

function rowToChatMessage(row: any): ChatMessage {
  return {
    id: row.id,
    content: row.content,
    user_name: row.user_name,
    created_at: row.created_at,
    role: row.role,
    status: row.status,
  };
}

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

// Helper function to create a concise chat name using OpenAI
async function generateChatName(message: string) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'Create a short, concise name (maximum 50 characters) that summarizes the following message. Return only the name, no quotes or explanation.',
        },
        {
          role: 'user',
          content: message,
        },
      ],
      max_tokens: 50,
    });

    // Extract and return the generated name
    const generatedName = completion.choices[0]?.message.content?.trim() || '';
    return generatedName.slice(0, 50); // Ensure name is not too long
  } catch (err) {
    console.error('Error generating chat name:', err);
    return null; // Return null if generation failed
  }
}

// Chat name generator tool
async function renameChat(chatId: string, context: string): Promise<string> {
  try {
    const newName = await generateChatName(context);
    if (newName) {
      await db`
        UPDATE chats
        SET name = ${newName}
        WHERE id = ${chatId}
      `;
      return newName;
    }
    return '';
  } catch (err) {
    console.error('Error renaming chat:', err);
    return '';
  }
}

// Chat rename tool
async function renameChatTo(chatId: string, name: string): Promise<string> {
  try {
    // Limit name to 50 characters
    const truncatedName = name.slice(0, 50);
    await db`
      UPDATE chats
      SET name = ${truncatedName}
      WHERE id = ${chatId}
    `;
    return truncatedName;
  } catch (err) {
    console.error('Error renaming chat:', err);
    return '';
  }
}

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
  // This abort controller is used to abort the message stream but also to
  // cancel the OpenAI stream when the message is aborted.
  const abortController = new AbortController();
  abortController.signal.addEventListener('abort', () => {
    // Wait 1 second, then delete tokens
    setTimeout(async () => {
      try {
        await db`DELETE FROM tokens WHERE message_id = ${messageId}`;
      } catch (err) {
        console.error('Error deleting tokens:', err);
      }
    }, 1000);
  });

  // Subscribe to the message
  const messageStream = new ShapeStream<{ id: string; status: string }>({
    url: `${ELECTRIC_API_URL}/v1/shape`,
    params: {
      table: 'messages',
      where: `id = '${messageId}'`,
      columns: ['id', 'status'],
    },
    signal: abortController.signal,
  });
  const messageShape = new Shape(messageStream);
  messageShape.subscribe(({ rows }) => {
    // Abort the message stream if the message is aborted
    const message = rows[0];
    if (message && message.status === 'aborted') {
      abortController.abort();
    }
  });

  // Convert chat history to OpenAI format
  const messages: ChatCompletionMessageParam[] = context.map(msg => ({
    role: msg.role === 'agent' ? 'assistant' : 'user',
    content: msg.content,
  }));

  // Call OpenAI with streaming
  const streamPromise = openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    stream: true,
    tools: [
      {
        type: 'function',
        function: {
          name: 'rename_chat',
          description: 'Rename the current chat session based on its content',
          parameters: {
            type: 'object',
            properties: {
              context: {
                type: 'string',
                description: 'A summary of the chat context to use for generating the new name',
              },
            },
            required: ['context'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'rename_chat_to',
          description: 'Rename the current chat session to a specific name provided by the user',
          parameters: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'The exact name to rename the chat to',
              },
            },
            required: ['name'],
          },
        },
      },
    ],
    tool_choice: 'auto',
  });
  abortController.signal.addEventListener('abort', async () => {
    (await streamPromise).controller.abort();
  });
  const stream = await streamPromise;

  let tokenNumber = 0;
  let fullContent = '';
  let toolCalls: ToolCall[] = [];

  // Process each chunk as it arrives
  let tokenBuffer = '';
  let lastInsertTime = 0;

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    const toolCall = chunk.choices[0]?.delta?.tool_calls?.[0];

    if (toolCall) {
      if (toolCall.id) {
        toolCalls.push({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.function?.name || '',
            arguments: toolCall.function?.arguments || '',
          },
        });
      } else if (toolCall.function?.arguments) {
        const lastCall = toolCalls[toolCalls.length - 1];
        if (lastCall) {
          lastCall.function.arguments += toolCall.function.arguments;
        }
      }
    }

    if (content) {
      fullContent += content;
      tokenBuffer += content;

      const currentTime = Date.now();
      if (currentTime - lastInsertTime >= 60 || tokenBuffer.length > 100) {
        // Store token batch in the tokens table
        await db`
          INSERT INTO tokens (message_id, token_number, token_text)
          VALUES (${messageId}, ${tokenNumber}, ${tokenBuffer})
        `;

        tokenNumber++;
        tokenBuffer = '';
        lastInsertTime = currentTime;
      }
    }
  }

  // Process any tool calls
  for (const toolCall of toolCalls) {
    try {
      const args = JSON.parse(toolCall.function.arguments);

      if (toolCall.function.name === 'rename_chat') {
        const newName = await renameChat(chatId, args.context);
        if (newName) {
          fullContent += `\n\nI've renamed this chat to: "${newName}"`;
        }
      } else if (toolCall.function.name === 'rename_chat_to') {
        const newName = await renameChatTo(chatId, args.name);
        if (newName) {
          fullContent += `\n\nI've renamed this chat to: "${newName}"`;
        }
      }
    } catch (err) {
      console.error('Error processing tool call:', err);
    }
  }

  // Insert any remaining tokens in the buffer
  if (tokenBuffer) {
    await db`
      INSERT INTO tokens (message_id, token_number, token_text)
      VALUES (${messageId}, ${tokenNumber}, ${tokenBuffer})
    `;
  }

  // Update the message with the complete content
  await db`
    UPDATE messages
    SET content = ${fullContent}, status = ${abortController.signal.aborted ? 'aborted' : 'completed'}
    WHERE id = ${messageId}
  `;

  // Abort the message stream
  abortController.abort();
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
