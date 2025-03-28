import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionAssistantMessageParam,
} from 'openai/resources/chat/completions';
import { Shape, ShapeStream } from '@electric-sql/client';
import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { ChatMessage, ToolCall } from '../types.js';
import { rowToChatMessage } from '../utils.js';
import { systemPrompt } from '../system-prompt.js';
import { basicTools, renameChat, renameChatTo, pinChat, generateChatName } from './tools/basic.js';
import { electricTools, electricChats, fetchElectricDocs } from './tools/electric.js';
import { processStreamChunks } from './stream.js';

export { generateChatName };
export const ENABLE_AI = true;
const ELECTRIC_API_URL = process.env.ELECTRIC_API_URL || 'http://localhost:3000';

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

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

  // Combine all tools
  const tools = [...basicTools, ...electricTools];

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
