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
import { getRecentActions, formatActionDescription, model, fetchSystemMessages } from '../utils.js';
import { systemPrompt } from './system-prompt.js';
import { basicTools } from './tools/basic.js';
import { electricTools, electricChats, fetchElectricDocs } from './tools/electric.js';
import { fileTools } from './tools/files.js';
import { postgresTools } from './tools/postgres.js';
import { todoTools } from './tools/todo/index.js';
import { ELECTRIC_API_URL } from '../urls.js';
import { processToolCall } from './tools/index.js';
import { openai } from './openai-client.js';

export interface ProcessAIStreamParams {
  chatId: string;
  messageId: string;
  context: ChatMessage[];
  dbUrlParam?: { redactedUrl: string; redactedId: string; password: string };
  recursionDepth?: number;
  baseMessages?: ChatCompletionMessageParam[];
  accumulatedContent?: string;
  currentTokenNumber?: number;
  currentTokenBuffer?: string;
  currentLastInsertTime?: number;
  excludeTools?: (string | RegExp)[];
}

// Process AI stream in background
export async function processAIStream({
  chatId,
  messageId,
  context,
  dbUrlParam,
  recursionDepth = 0,
  baseMessages = [],
  accumulatedContent = '',
  currentTokenNumber = 0,
  currentTokenBuffer = '',
  currentLastInsertTime = Date.now(),
  excludeTools = [],
}: ProcessAIStreamParams) {
  // Limit recursion depth to prevent infinite loops
  const MAX_RECURSION_DEPTH = 10;
  if (recursionDepth > MAX_RECURSION_DEPTH) {
    console.log(`Reached maximum recursion depth (${MAX_RECURSION_DEPTH}), stopping`);

    // Update the message with the accumulated content
    await db`
      UPDATE messages
      SET status = 'completed', content = ${accumulatedContent + '\n\nReached maximum number of tool calls.'}, updated_at = NOW()
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
          ...context.map(msg => {
            // If the message has an attachment, include it in the content
            let content = msg.content;
            if ('attachment' in msg && msg.attachment) {
              content += `\n\n[ATTACHED FILE CONTENT]\n${msg.attachment}\n[END OF ATTACHED FILE]`;
            }

            return {
              role: msg.role === 'agent' ? 'assistant' : ('user' as const),
              content: content,
            } as ChatCompletionUserMessageParam | ChatCompletionAssistantMessageParam;
          }),
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
  const tools = [
    ...basicTools,
    ...electricTools,
    ...fileTools,
    ...postgresTools,
    ...todoTools,
  ].filter(tool => {
    for (const excludeTool of excludeTools) {
      if (typeof excludeTool === 'string' && tool.function.name === excludeTool) {
        return false;
      } else if (excludeTool instanceof RegExp && excludeTool.test(tool.function.name)) {
        return false;
      }
    }
    return true;
  });

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

    // Update the message to pending status and ensure the updated_at is set to now
    await db`
      UPDATE messages
      SET status = 'pending', updated_at = NOW()
      WHERE id = ${messageId}
    `;

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
        if (currentTime - lastInsertTime >= 60 || tokenBuffer.length > 30) {
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
      const result = await processToolCall({
        toolCall,
        chatId,
        messageId: currentMessageId,
        abortController,
        dbUrlParam,
      });

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
          SET status = 'completed', 
              content = ${fullContent}, 
              thinking_text = '',
              updated_at = NOW()
          WHERE id = ${currentMessageId}
        `;

        // Delete tokens for the completed message
        await db`DELETE FROM tokens WHERE message_id = ${currentMessageId}`;

        // Create a new message for content that will come after this tool call
        currentMessageId = randomUUID();
        await db`
          INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at, updated_at)
          VALUES (${currentMessageId}, ${chatId}, '', 'AI Assistant', 'agent', 'pending', NOW(), NOW())
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
        SET thinking_text = 'Processing tool results and continuing...', updated_at = NOW()
        WHERE id = ${currentMessageId}
      `;

      // Make a recursive call with the new message ID
      console.log(
        `Making recursive call at depth ${recursionDepth + 1} with ${systemMessages.length} new system messages`
      );

      return processAIStream({
        chatId,
        messageId: currentMessageId,
        context,
        dbUrlParam,
        recursionDepth: recursionDepth + 1,
        baseMessages: nextMessages,
        accumulatedContent: fullContent,
        currentTokenNumber: tokenNumber,
        currentTokenBuffer: tokenBuffer,
        currentLastInsertTime: lastInsertTime,
        excludeTools,
      });
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
          SET status = CASE WHEN status != 'aborted' THEN 'completed' ELSE status END,
              content = ${fullContent}, 
              thinking_text = '',
              updated_at = NOW()
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
      SET status = 'completed', 
          content = ${fullContent}, 
          thinking_text = '',
          updated_at = NOW()
      WHERE id = ${currentMessageId}
    `;

    // Delete tokens
    await db`DELETE FROM tokens WHERE message_id = ${currentMessageId}`;
  }
}
