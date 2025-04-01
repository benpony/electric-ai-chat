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
import { ChatMessage, ToolCall, ToolHandler } from '../types.js';
import { rowToChatMessage } from '../utils.js';
import { systemPrompt } from './system-prompt.js';
import { basicTools, basicToolHandlers, generateChatName } from './tools/basic.js';
import {
  electricTools,
  electricToolHandlers,
  electricChats,
  fetchElectricDocs,
} from './tools/electric.js';
import { fileTools, fileToolHandlers } from './tools/files.js';
import { postgresTools, postgresToolHandlers } from './tools/postgres.js';
import { processStreamChunks } from './stream.js';
import { model } from '../utils.js';
import { todoTools, todoToolHandlers } from './tools/todo.js';

export { generateChatName };
export const ENABLE_AI = true;
const ELECTRIC_API_URL = process.env.ELECTRIC_API_URL || 'http://localhost:3000';

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

// Combine all tool handlers and create a map for quick lookup
const allToolHandlers = [
  ...basicToolHandlers,
  ...electricToolHandlers,
  ...fileToolHandlers,
  ...postgresToolHandlers,
  ...todoToolHandlers,
];
const toolHandlerMap = new Map<string, ToolHandler>();
allToolHandlers.forEach(handler => {
  toolHandlerMap.set(handler.name, handler);
});

// Helper function to create AI response
export async function createAIResponse(
  chatId: string,
  contextRows: any[],
  dbUrl?: { redactedUrl: string; redactedId: string; password: string }
) {
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
    processAIStream(chatId, messageId, limitedContext, dbUrl).catch(error => {
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

// Process each tool call and return the result
async function processToolCall(
  toolCall: ToolCall,
  chatId: string,
  messageId: string,
  dbUrlParam?: { redactedUrl: string; redactedId: string; password: string }
): Promise<{
  content: string;
  systemMessage?: string;
  requiresReentry?: boolean;
}> {
  try {
    const args = JSON.parse(toolCall.function.arguments) as unknown;
    console.log('Processing tool call:', toolCall.function.name, args);

    // Find the handler for this tool
    const handler = toolHandlerMap.get(toolCall.function.name);

    if (!handler) {
      return { content: `\n\nUnsupported tool call: ${toolCall.function.name}` };
    }

    // Set thinking text based on the handler
    const thinkingText = handler.getThinkingText(args);

    // Update the message with the thinking text
    await db`
      UPDATE messages
      SET thinking_text = ${thinkingText}
      WHERE id = ${messageId}
    `;

    try {
      // Process the tool call
      const result = await handler.process(args, chatId, messageId, dbUrlParam);

      // Clear the thinking text
      await db`
        UPDATE messages
        SET thinking_text = ''
        WHERE id = ${messageId}
      `;

      return result;
    } catch (error) {
      console.error(`Error processing ${toolCall.function.name}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      // Clear the thinking text on error
      await db`
        UPDATE messages
        SET thinking_text = ''
        WHERE id = ${messageId}
      `;

      return { content: `\n\nError processing ${toolCall.function.name}: ${errorMessage}` };
    }
  } catch (error) {
    console.error('Error processing tool call:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    // Clear the thinking text on error
    await db`
      UPDATE messages
      SET thinking_text = ''
      WHERE id = ${messageId}
    `;

    return { content: `\n\nError processing tool call: ${errorMessage}` };
  }
}

// Process AI stream in background
async function processAIStream(
  chatId: string,
  messageId: string,
  context: ChatMessage[],
  dbUrlParam?: { redactedUrl: string; redactedId: string; password: string },
  recursionDepth: number = 0,
  baseMessages: ChatCompletionMessageParam[] = [],
  accumulatedContent: string = '',
  currentTokenNumber: number = 0,
  currentTokenBuffer: string = '',
  currentLastInsertTime: number = Date.now()
) {
  // Limit recursion depth to prevent infinite loops
  const MAX_RECURSION_DEPTH = 10;
  if (recursionDepth > MAX_RECURSION_DEPTH) {
    console.log(`Reached maximum recursion depth (${MAX_RECURSION_DEPTH}), stopping`);

    // Update the message with the accumulated content
    await db`
      UPDATE messages
      SET status = 'completed', content = ${accumulatedContent + '\n\nReached maximum number of tool calls.'}
      WHERE id = ${messageId}
    `;

    // Delete tokens
    await db`DELETE FROM tokens WHERE message_id = ${messageId}`;
    return;
  }

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

  // Use base messages if provided (from recursion), otherwise create from scratch
  let messages: ChatCompletionMessageParam[] =
    baseMessages.length > 0
      ? [...baseMessages]
      : [
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

  // If this is an ElectricSQL chat and we're not in a recursive call, add the full documentation
  if (electricChats.has(chatId) && recursionDepth === 0) {
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

  // Initialize or reuse state from previous recursive calls
  let tokenNumber = currentTokenNumber;
  let fullContent = accumulatedContent;
  let toolCalls: ToolCall[] = [];
  let tokenBuffer = currentTokenBuffer;
  let lastInsertTime = currentLastInsertTime;

  // Combine all tools
  const tools = [...basicTools, ...electricTools, ...fileTools, ...postgresTools, ...todoTools];

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

    // Collect system messages for the next recursive call
    const systemMessages: ChatCompletionSystemMessageParam[] = [];

    // Process any tool calls
    for (const toolCall of toolCalls) {
      const result = await processToolCall(toolCall, chatId, messageId, dbUrlParam);

      // Add any direct content to the response
      if (result.content) {
        fullContent += result.content;
        tokenBuffer += result.content;
      }

      // If the tool result includes a system message, add it to the collection
      if (result.systemMessage) {
        systemMessages.push({
          role: 'system',
          content: result.systemMessage,
        } as ChatCompletionSystemMessageParam);
      }
    }

    // If we have new system messages from tool calls, make a recursive call
    if (systemMessages.length > 0) {
      // Create a new messages array with all previous messages plus the new system messages
      const nextMessages = [...messages, ...systemMessages];

      // Show a thinking state
      await db`
        UPDATE messages
        SET thinking_text = 'Processing tool results and continuing...'
        WHERE id = ${messageId}
      `;

      // Update with current progress
      if (tokenBuffer.length > 0) {
        await db`
          INSERT INTO tokens (message_id, token_number, token_text)
          VALUES (${messageId}, ${tokenNumber}, ${tokenBuffer})
        `;
        tokenNumber++;
        tokenBuffer = '';
        lastInsertTime = Date.now();
      }

      // Make a recursive call
      console.log(
        `Making recursive call at depth ${recursionDepth + 1} with ${systemMessages.length} new system messages`
      );

      return processAIStream(
        chatId,
        messageId,
        context,
        dbUrlParam,
        recursionDepth + 1,
        nextMessages,
        fullContent,
        tokenNumber,
        tokenBuffer,
        lastInsertTime
      );
    } else {
      // No more tool calls, finalize the message
      if (tokenBuffer.length > 0) {
        await db`
          INSERT INTO tokens (message_id, token_number, token_text)
          VALUES (${messageId}, ${tokenNumber}, ${tokenBuffer})
        `;
      }

      // Update the message with the final content
      await db`
        UPDATE messages
        SET status = 'completed', content = ${fullContent}, thinking_text = ''
        WHERE id = ${messageId}
      `;

      // Delete tokens
      await db`DELETE FROM tokens WHERE message_id = ${messageId}`;
    }
  } catch (error) {
    console.error('Error processing AI stream:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    fullContent += `\n\nError processing AI stream: ${errorMessage}`;
    tokenBuffer += `\n\nError processing AI stream: ${errorMessage}`;

    // Update the message with error content
    await db`
      UPDATE messages
      SET status = 'completed', content = ${fullContent}, thinking_text = ''
      WHERE id = ${messageId}
    `;

    // Delete tokens
    await db`DELETE FROM tokens WHERE message_id = ${messageId}`;
  }
}
