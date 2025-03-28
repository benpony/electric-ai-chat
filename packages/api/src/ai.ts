import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Shape, ShapeStream } from '@electric-sql/client';
import { randomUUID } from 'crypto';
import { db } from './db.js';
import { ChatMessage, ToolCall } from './types.js';
import { rowToChatMessage } from './utils.js';

export const ENABLE_AI = true;
const ELECTRIC_API_URL = process.env.ELECTRIC_API_URL || 'http://localhost:3000';

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

// Helper function to create a concise chat name using OpenAI
export async function generateChatName(message: string) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'Create a short, concise human readable name (maximum 50 characters) that summarizes the following message. Return only the name, no quotes or explanation. It will be used in the UI as the chat name.',
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
export async function renameChat(chatId: string, context: string): Promise<string> {
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
export async function renameChatTo(chatId: string, name: string): Promise<string> {
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
export async function createAIResponse(chatId: string, contextRows: any[]) {
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