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
import {
  fileTools,
  createFile,
  editFile,
  deleteFile,
  renameFile,
  readFile,
} from './tools/files.js';
import { processStreamChunks } from './stream.js';
import { model } from '../utils.js';

export { generateChatName };
export const ENABLE_AI = true;
const ELECTRIC_API_URL = process.env.ELECTRIC_API_URL || 'http://localhost:3000';

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

// Helper function to create AI response
export async function createAIResponse(chatId: string, contextRows: any[]) {
  try {
    // Convert rows to ChatMessage objects and limit context size
    const context = contextRows.map(rowToChatMessage);
    const limitedContext = limitContextSize(context);

    // Create a pending AI message
    const messageId = randomUUID();

    // Insert pending message
    await db`
      INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at)
      VALUES (${messageId}, ${chatId}, '', 'AI Assistant', 'agent', 'pending', NOW())
    `;

    // Start streaming in background
    processAIStream(chatId, messageId, limitedContext).catch(error => {
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

// Helper function to limit context size
function limitContextSize(messages: ChatMessage[]): ChatMessage[] {
  // Keep the system prompt and the most recent messages
  const systemPrompt = messages[0];
  const recentMessages = messages.slice(1);

  // Estimate tokens (rough approximation)
  let totalTokens = 0;
  const maxTokens = 20000; // More conservative limit to leave room for response
  const limitedMessages: ChatMessage[] = [systemPrompt];

  // Add messages from most recent to oldest until we hit the token limit
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const message = recentMessages[i];
    // More conservative estimate: 1 token ≈ 3 characters
    const messageTokens = Math.ceil(message.content.length / 3);

    if (totalTokens + messageTokens > maxTokens) {
      break;
    }

    totalTokens += messageTokens;
    limitedMessages.unshift(message);
  }

  return limitedMessages;
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
      // Only add docs if we're not already close to the token limit
      const estimatedTokens = messages.reduce(
        (acc, msg) => acc + Math.ceil((msg.content || '').length / 3),
        0
      );
      if (estimatedTokens < 15000) {
        // Only add docs if we have room
        messages.push({
          role: 'system',
          content: `Here's the complete ElectricSQL documentation:\n${docs}`,
        } as ChatCompletionSystemMessageParam);
      } else {
        // If we're close to the limit, just add a note that docs are available
        messages.push({
          role: 'system',
          content:
            'ElectricSQL documentation is available. Use the fetch_electric_docs tool to get specific documentation when needed.',
        } as ChatCompletionSystemMessageParam);
      }
    }
  }

  let tokenNumber = 0;
  let fullContent = '';
  let toolCalls: ToolCall[] = [];
  let tokenBuffer = '';
  let lastInsertTime = Date.now();

  // Combine all tools
  const tools = [...basicTools, ...electricTools, ...fileTools];

  try {
    // Call OpenAI with streaming
    const streamPromise = openai.chat.completions.create({
      model,
      messages,
      stream: true,
      tools,
      tool_choice: 'auto',
      max_tokens: 4000, // Limit response size
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
              model,
              messages,
              stream: true,
              tools,
              tool_choice: 'auto',
              max_tokens: 4000, // Limit response size
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
        } else if (toolCall.function.name === 'create_file') {
          const result = await createFile(chatId, args.path, args.mime_type, args.content);
          if (result.success) {
            fullContent += `\n\nI've created the file "${args.path}"`;
          } else {
            fullContent += `\n\nFailed to create file "${args.path}": ${result.error}`;
          }
        } else if (toolCall.function.name === 'edit_file') {
          const result = await editFile(chatId, args.path, args.content);
          if (result.success) {
            fullContent += `\n\nI've updated the file "${args.path}"`;
          } else {
            fullContent += `\n\nFailed to update file "${args.path}": ${result.error}`;
          }
        } else if (toolCall.function.name === 'delete_file') {
          const result = await deleteFile(chatId, args.path);
          if (result.success) {
            fullContent += `\n\nI've deleted the file "${args.path}"`;
          } else {
            fullContent += `\n\nFailed to delete file "${args.path}": ${result.error}`;
          }
        } else if (toolCall.function.name === 'rename_file') {
          const result = await renameFile(chatId, args.old_path, args.new_path);
          if (result.success) {
            fullContent += `\n\nI've renamed "${args.old_path}" to "${args.new_path}"`;
          } else {
            fullContent += `\n\nFailed to rename file: ${result.error}`;
          }
        } else if (toolCall.function.name === 'read_file') {
          const result = await readFile(chatId, args.path);
          if (result.success && result.file) {
            fullContent += `\n\nHere's the contents of "${args.path}":\n\`\`\`\n${result.file.content}\n\`\`\``;
          } else {
            fullContent += `\n\nFailed to read file "${args.path}": ${result.error}`;
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
  } catch (error) {
    console.error('Error in AI streaming:', error);
    // Update message to failed status with error details
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await db`
      UPDATE messages
      SET status = 'failed', content = ${`Failed to generate response: ${errorMessage}`}
      WHERE id = ${messageId}
    `;
  }

  // Abort the message stream
  abortController.abort();
}
