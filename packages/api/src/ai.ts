import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { Shape, ShapeStream } from '@electric-sql/client';
import { randomUUID } from 'crypto';
import { db } from './db.js';
import { ChatMessage, ToolCall } from './types.js';
import { rowToChatMessage } from './utils.js';
import { systemPrompt } from './system-prompt.js';

export const ENABLE_AI = true;
const ELECTRIC_API_URL = process.env.ELECTRIC_API_URL || 'http://localhost:3000';
const ELECTRIC_DOCS_URL = 'https://electric-sql.com/llms.txt';

// Cache for ElectricSQL documentation
let electricDocsCache: string | null = null;
let lastFetchTime: number = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Track if a chat has started discussing ElectricSQL
// If the chat has started discussing ElectricSQL, we will continue to provide the full
// llms.txt documentation to the AI as a system message on each prompt.
const electricChats = new Set<string>();

async function fetchElectricDocs(): Promise<string> {
  const now = Date.now();
  if (electricDocsCache && now - lastFetchTime < CACHE_DURATION) {
    return electricDocsCache;
  }

  try {
    const response = await fetch(ELECTRIC_DOCS_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch ElectricSQL docs: ${response.statusText}`);
    }
    electricDocsCache = await response.text();
    lastFetchTime = now;
    return electricDocsCache;
  } catch (error) {
    console.error('Error fetching ElectricSQL docs:', error);
    return ''; // Return empty string on error
  }
}

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

// Pin/Unpin chat tool
export async function pinChat(chatId: string, pinned: boolean): Promise<boolean> {
  try {
    await db`
      UPDATE chats
      SET pinned = ${pinned}
      WHERE id = ${chatId}
    `;
    return true;
  } catch (err) {
    console.error('Error pinning/unpinning chat:', err);
    return false;
  }
}

// Define tools once at the top level
const tools: ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'fetch_electric_docs',
      description:
        'Fetch the latest ElectricSQL documentation to help answer questions about ElectricSQL features, best practices, and solutions',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The specific query or topic to look up in the documentation',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
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
    type: 'function' as const,
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
  {
    type: 'function' as const,
    function: {
      name: 'pin_chat',
      description: 'Pin the current chat to keep it at the top of the sidebar',
      parameters: {
        type: 'object',
        properties: {
          pinned: {
            type: 'boolean',
            description: 'Whether to pin (true) or unpin (false) the chat',
          },
        },
        required: ['pinned'],
      },
    },
  },
];

// Helper function to process stream chunks
async function processStreamChunks(
  stream: AsyncIterable<any>,
  messageId: string,
  tokenNumber: number,
  tokenBuffer: string,
  lastInsertTime: number
): Promise<{
  fullContent: string;
  tokenNumber: number;
  tokenBuffer: string;
  lastInsertTime: number;
}> {
  let fullContent = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      fullContent += content;
      tokenBuffer += content;

      const currentTime = Date.now();
      if (currentTime - lastInsertTime >= 60 || tokenBuffer.length > 100) {
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
  return { fullContent, tokenNumber, tokenBuffer, lastInsertTime };
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

  // Check if this is an ElectricSQL-related question
  const isElectricQuestion = context.some(
    msg =>
      msg.role === 'user' &&
      (msg.content.toLowerCase().includes('electric') ||
        msg.content.toLowerCase().includes('electric-sql') ||
        msg.content.toLowerCase().includes('electric sql'))
  );

  // If it's an ElectricSQL question, mark this chat as an ElectricSQL chat
  if (isElectricQuestion) {
    electricChats.add(chatId);
  }

  // Convert chat history to OpenAI format
  const messages: ChatCompletionMessageParam[] = [
    systemPrompt,
    ...context.map(
      msg =>
        ({
          role: msg.role === 'agent' ? 'assistant' : ('user' as const),
          content: msg.content,
        }) as ChatCompletionUserMessageParam | ChatCompletionAssistantMessageParam
    ),
    {
      role: 'assistant',
      content: '',
    },
  ];

  // If this is an ElectricSQL chat, add the full documentation
  if (electricChats.has(chatId)) {
    const docs = await fetchElectricDocs();
    if (docs) {
      messages.push({
        role: 'system',
        content: `Here's the complete ElectricSQL documentation:\n${docs}`,
      } as ChatCompletionSystemMessageParam);
    }
  }

  let tokenNumber = 0;
  let fullContent = '';
  let toolCalls: ToolCall[] = [];
  let tokenBuffer = '';
  let lastInsertTime = Date.now();

  // Call OpenAI with streaming
  const streamPromise = openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    stream: true,
    tools,
    tool_choice: 'auto',
  });

  abortController.signal.addEventListener('abort', async () => {
    (await streamPromise).controller.abort();
  });
  const stream = await streamPromise;

  // Process each chunk as it arrives
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

      if (toolCall.function.name === 'fetch_electric_docs') {
        console.log('fetch_electric_docs', args);
        // Add the chatId to the set of ElectricSQL chats
        electricChats.add(chatId);
        const docs = await fetchElectricDocs();
        if (docs) {
          // Add the docs as a system message and continue the conversation
          messages.push({
            role: 'system',
            content: `Here's the relevant ElectricSQL documentation for "${args.query}":\n${docs}`,
          } as ChatCompletionSystemMessageParam);

          // Get a new completion with the updated context
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages,
            stream: true,
            tools,
            tool_choice: 'auto',
          });

          // Process the new stream
          const result = await processStreamChunks(
            completion,
            messageId,
            tokenNumber,
            tokenBuffer,
            lastInsertTime
          );
          fullContent += result.fullContent;
          tokenNumber = result.tokenNumber;
          tokenBuffer = result.tokenBuffer;
          lastInsertTime = result.lastInsertTime;
          continue; // Skip the rest of the tool calls since we've handled this one
        }
      } else if (toolCall.function.name === 'rename_chat') {
        const newName = await renameChat(chatId, args.context);
        if (newName) {
          fullContent += `\n\nI've renamed this chat to: "${newName}"`;
        }
      } else if (toolCall.function.name === 'rename_chat_to') {
        const newName = await renameChatTo(chatId, args.name);
        if (newName) {
          fullContent += `\n\nI've renamed this chat to: "${newName}"`;
        }
      } else if (toolCall.function.name === 'pin_chat') {
        const success = await pinChat(chatId, args.pinned);
        if (success) {
          fullContent += `\n\nI've ${args.pinned ? 'pinned' : 'unpinned'} this chat.`;
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
