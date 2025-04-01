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
import {
  rowToChatMessage,
  getRecentActions,
  formatActionDescription,
  storeToolCall,
  detectSimilarToolCalls,
} from '../utils.js';
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

    // Check for similar previous tool calls
    const similarCall = await detectSimilarToolCalls(chatId, toolCall.function.name, args, handler);
    if (similarCall) {
      console.log(`Detected similar previous call to ${toolCall.function.name}`);

      // For certain tools, we want to warn about potential duplicates
      const potentialDuplicateTools = [
        'create_todo_list',
        'create_todo_item',
        'update_todo_item',
        'delete_todo_list',
        'delete_todo_item',
      ];

      if (potentialDuplicateTools.includes(toolCall.function.name)) {
        // Format the time difference
        const timeDiff = new Date().getTime() - new Date(similarCall.timestamp).getTime();
        const minutes = Math.floor(timeDiff / 60000);
        const timeDesc =
          minutes < 1
            ? 'just now'
            : minutes < 60
              ? `${minutes} minute(s) ago`
              : `${Math.floor(minutes / 60)} hour(s) ago`;

        // Warn the LLM about the potential duplicate
        return {
          content: '',
          systemMessage: `WARNING: You are attempting to call ${toolCall.function.name} with similar arguments to a previous call made ${timeDesc}. 
          
Previous call details:
Tool: ${similarCall.toolName}
Arguments: ${JSON.stringify(similarCall.args, null, 2)}
Result: ${similarCall.result}

If you're intentionally repeating this operation, please proceed. Otherwise, consider if this is necessary or if you might be duplicating a previous action.`,
          requiresReentry: true,
        };
      }
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

      // Store both the tool call and a system message
      // Extract entity information for better tracking
      let entityId = 'none';
      let entityName = toolCall.function.name;
      let entityType = 'none';

      // Extract entity info from common tools
      if (toolCall.function.name === 'create_todo_list' && result.systemMessage) {
        const match = result.systemMessage.match(/ID: ([a-f0-9-]+)/i);
        if (match) entityId = match[1];

        const nameMatch = result.systemMessage.match(/list: "([^"]+)"/i);
        if (nameMatch) entityName = nameMatch[1];

        entityType = 'list';
      } else if (toolCall.function.name === 'create_todo_item' && result.systemMessage) {
        const match = result.systemMessage.match(/ID: ([a-f0-9-]+)/i);
        if (match) entityId = match[1];

        const nameMatch = result.systemMessage.match(/item: "([^"]+)"/i);
        if (nameMatch) entityName = nameMatch[1];

        entityType = 'item';
      } else if (toolCall.function.name === 'update_todo_item' && args && (args as any).item_id) {
        entityId = (args as any).item_id;
        entityType = 'item';

        if (result.systemMessage) {
          const nameMatch = result.systemMessage.match(/todo item "([^"]+)"/i);
          if (nameMatch) entityName = nameMatch[1];
        }
      }

      // Store tool call for future reference
      await storeToolCall(
        chatId,
        toolCall.function.name,
        args,
        result.systemMessage || 'Success',
        entityId,
        entityName,
        entityType
      );

      // Store system message for context history if there's a system message
      if (result.systemMessage) {
        // Prepend with tool information for better context
        const contextMessage = `TOOL EXECUTION [${handler.name}]: ${result.systemMessage}`;
        await storeSystemMessage(chatId, contextMessage);
      }

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

      // Store error as system message for context
      const errorContext = `TOOL ERROR [${handler.name}]: ${errorMessage}`;
      await storeSystemMessage(chatId, errorContext);

      // Track the error
      await storeToolCall(
        chatId,
        toolCall.function.name,
        args,
        `Error: ${errorMessage}`,
        'none',
        toolCall.function.name,
        'error'
      );

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

// Add a function to retrieve system messages from the database
async function fetchSystemMessages(chatId: string): Promise<ChatCompletionSystemMessageParam[]> {
  try {
    const systemMessages = await db`
      SELECT content, created_at
      FROM messages
      WHERE chat_id = ${chatId} AND role = 'system'
      ORDER BY created_at ASC
    `;

    return systemMessages.map(msg => ({
      role: 'system' as const,
      content: msg.content,
    }));
  } catch (error) {
    console.error('Error fetching system messages:', error);
    return []; // Return empty array on error
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

  // Get any stored system messages from previous interactions
  const storedSystemMessages = recursionDepth === 0 ? await fetchSystemMessages(chatId) : [];

  // Add a boundary system message if this is a new conversation (not recursion)
  if (recursionDepth === 0) {
    // Get recent todo lists and items for context
    const recentLists = await db`
      SELECT * FROM todo_lists ORDER BY updated_at DESC LIMIT 5
    `;

    const recentItems = await db`
      SELECT i.*, l.name as list_name 
      FROM todo_items i
      JOIN todo_lists l ON i.list_id = l.id
      ORDER BY i.updated_at DESC LIMIT 10
    `;

    // Get recent actions for context
    const recentActions = await getRecentActions(chatId, 10);

    // Find the most recently created or updated list or item
    let mostRecentContext = 'todo management';
    if (recentActions.length > 0) {
      mostRecentContext = formatActionDescription(recentActions[0]);
    }

    // Create a boundary message that summarizes context
    const boundaryMessage = {
      role: 'system' as const,
      content: `
=== CURRENT CONTEXT STATE ===

Todo Lists:
${recentLists.map((l: any) => `- "${l.name}" (ID: ${l.id})`).join('\n')}

Recent Items:
${recentItems.map((i: any) => `- ${i.done ? '✓' : '□'} "${i.task}" (ID: ${i.id}, List: "${i.list_name}")`).join('\n')}

Recent Actions:
${recentActions.map((a: any) => `- ${formatActionDescription(a)}`).join('\n')}

Current Context: You're helping with todo list management. The most recent interaction was about "${mostRecentContext}".

=== END OF CONTEXT STATE ===
`,
    };

    // Add the boundary message for context
    if (recentLists.length > 0 || recentItems.length > 0 || recentActions.length > 0) {
      storedSystemMessages.push(boundaryMessage);
    }

    // Add previous tool operations summary if there are stored system messages
    if (storedSystemMessages.length > 0) {
      // Create a summary of previous tool executions
      const toolSummaryMessage = {
        role: 'system' as const,
        content: `=== PREVIOUS TOOL OPERATIONS SUMMARY ===
The following tool operations have already been performed in this conversation:
${storedSystemMessages
  .filter(msg => {
    const content = typeof msg.content === 'string' ? msg.content : '';
    return content.startsWith('TOOL EXECUTION');
  })
  .map(msg => {
    // Extract the important part of each stored message
    const content = typeof msg.content === 'string' ? msg.content : '';
    return '- ' + content.replace('TOOL EXECUTION ', '');
  })
  .join('\n')}

Please avoid repeating these operations unless specifically requested by the user.
=== END OF TOOL OPERATIONS SUMMARY ===`,
      };

      // Add to system messages if there are tool executions to summarize
      if (toolSummaryMessage.content.includes('-')) {
        storedSystemMessages.push(toolSummaryMessage);
      }
    }
  }

  // Use base messages if provided (from recursion), otherwise create from scratch
  let messages: ChatCompletionMessageParam[] =
    baseMessages.length > 0
      ? [...baseMessages]
      : [
          systemPrompt,
          // Add stored system messages from previous interactions, if any
          ...storedSystemMessages,
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
  let currentMessageId = messageId;

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
            VALUES (${currentMessageId}, ${tokenNumber}, ${tokenBuffer})
          `;
          tokenNumber++;
          tokenBuffer = '';
          lastInsertTime = currentTime;
        }
      }
    }

    // Collect system messages for the next recursive call
    const systemMessages: ChatCompletionSystemMessageParam[] = [];

    // Process each tool call, completing the current message and creating a new one after each call
    for (const toolCall of toolCalls) {
      // Process the tool call
      const result = await processToolCall(toolCall, chatId, currentMessageId, dbUrlParam);

      // Complete the current message if it has content
      if (fullContent.trim().length > 0) {
        // Save any remaining token buffer
        if (tokenBuffer.length > 0) {
          await db`
            INSERT INTO tokens (message_id, token_number, token_text)
            VALUES (${currentMessageId}, ${tokenNumber}, ${tokenBuffer})
          `;
        }

        // Update the current message to completed status
        await db`
          UPDATE messages
          SET status = 'completed', content = ${fullContent}, thinking_text = ''
          WHERE id = ${currentMessageId}
        `;

        // Delete tokens for the completed message
        await db`DELETE FROM tokens WHERE message_id = ${currentMessageId}`;

        // Create a new message for content that will come after this tool call
        currentMessageId = randomUUID();
        await db`
          INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at)
          VALUES (${currentMessageId}, ${chatId}, '', 'AI Assistant', 'agent', 'pending', NOW())
        `;

        // Reset tracking variables for the new message
        fullContent = result.content || '';
        tokenBuffer = fullContent;
        tokenNumber = 0;

        // Insert initial content if we have any from the tool result
        if (tokenBuffer.length > 0) {
          await db`
            INSERT INTO tokens (message_id, token_number, token_text)
            VALUES (${currentMessageId}, ${tokenNumber}, ${tokenBuffer})
          `;
          tokenNumber++;
          tokenBuffer = '';
        }
      } else {
        // If no content, just add the tool result to the current message
        fullContent = result.content || '';
        tokenBuffer = fullContent;

        // Insert content if we have any from the tool result
        if (tokenBuffer.length > 0) {
          await db`
            INSERT INTO tokens (message_id, token_number, token_text)
            VALUES (${currentMessageId}, ${tokenNumber}, ${tokenBuffer})
          `;
          tokenNumber++;
          tokenBuffer = '';
        }
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
        WHERE id = ${currentMessageId}
      `;

      // Make a recursive call with the new message ID
      console.log(
        `Making recursive call at depth ${recursionDepth + 1} with ${systemMessages.length} new system messages`
      );

      return processAIStream(
        chatId,
        currentMessageId,
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
      if (fullContent.trim().length > 0) {
        if (tokenBuffer.length > 0) {
          await db`
            INSERT INTO tokens (message_id, token_number, token_text)
            VALUES (${currentMessageId}, ${tokenNumber}, ${tokenBuffer})
          `;
        }

        // Update the message with the final content
        await db`
          UPDATE messages
          SET status = 'completed', content = ${fullContent}, thinking_text = ''
          WHERE id = ${currentMessageId}
        `;

        // Delete tokens
        await db`DELETE FROM tokens WHERE message_id = ${currentMessageId}`;
      } else {
        // No content in the final message, delete it
        await db`DELETE FROM messages WHERE id = ${currentMessageId}`;
        await db`DELETE FROM tokens WHERE message_id = ${currentMessageId}`;
      }
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
      WHERE id = ${currentMessageId}
    `;

    // Delete tokens
    await db`DELETE FROM tokens WHERE message_id = ${currentMessageId}`;
  }
}

// Add this function to store system messages for historical context
async function storeSystemMessage(chatId: string, content: string) {
  try {
    const messageId = randomUUID();

    await db`
      INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at)
      VALUES (${messageId}, ${chatId}, ${content}, 'System', 'system', 'completed', NOW())
    `;

    console.log(`Stored system message for context: ${content.substring(0, 50)}...`);
    return messageId;
  } catch (error) {
    console.error('Error storing system message:', error);
    // Non-critical error, so we just log it and continue
    return null;
  }
}
