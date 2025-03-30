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
import { systemPrompt } from './system-prompt.js';
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
import { getDatabaseSchema, executeReadOnlyQuery, postgresTools } from './tools/postgres.js';
import { processStreamChunks } from './stream.js';
import { model } from '../utils.js';

export { generateChatName };
export const ENABLE_AI = true;
const ELECTRIC_API_URL = process.env.ELECTRIC_API_URL || 'http://localhost:3000';

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
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
    const args = JSON.parse(toolCall.function.arguments);
    console.log('Processing tool call:', toolCall.function.name, args);

    // Set thinking text based on the tool being called
    let thinkingText = '';
    switch (toolCall.function.name) {
      case 'execute_postgres_query':
        thinkingText = `Running SQL query: ${args.query.substring(0, 50)}${args.query.length > 50 ? '...' : ''}`;
        break;
      case 'create_file':
        thinkingText = `Creating file: ${args.path}`;
        break;
      case 'edit_file':
        thinkingText = `Editing file: ${args.path}`;
        break;
      case 'delete_file':
        thinkingText = `Deleting file: ${args.path}`;
        break;
      case 'rename_file':
        thinkingText = `Renaming file: ${args.old_path} → ${args.new_path}`;
        break;
      case 'read_file':
        thinkingText = `Reading file: ${args.path}`;
        break;
      case 'fetch_electric_docs':
        thinkingText = 'Fetching ElectricSQL documentation...';
        break;
      case 'get_database_schema':
        thinkingText = 'Getting database schema...';
        break;
      default:
        thinkingText = `Running ${toolCall.function.name}...`;
    }

    // Update the message with the thinking text
    await db`
      UPDATE messages
      SET thinking_text = ${thinkingText}
      WHERE id = ${messageId}
    `;

    let result: { content: string; systemMessage?: string; requiresReentry?: boolean } = { content: '' };
    switch (toolCall.function.name) {
      case 'fetch_electric_docs': {
        // Add the chatId to the set of ElectricSQL chats
        electricChats.add(chatId);
        const docs = await fetchElectricDocs();
        if (docs) {
          result = {
            content: '',
            systemMessage: `Here's the relevant ElectricSQL documentation for "${args.query}":\n${docs}`,
            requiresReentry: true,
          };
        } else {
          result = { content: '\n\nFailed to fetch ElectricSQL documentation.' };
        }
        break;
      }

      case 'get_database_schema': {
        if (!dbUrlParam) {
          result = {
            content:
              '\n\nI need a database URL to get the schema. Please provide one in your message.',
          };
        } else {
          // Get the schema from the database
          const schema = await getDatabaseSchema(args.redactedUrl, dbUrlParam.password);
          result = {
            content: '',
            systemMessage: `Here's the database schema information:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\nPlease use this information to answer the user's question about the database schema.`,
            requiresReentry: true,
          };
        }
        break;
      }

      case 'execute_postgres_query': {
        if (!dbUrlParam) {
          result = {
            content:
              '\n\nI need a database URL to execute queries. Please provide one in your message.',
          };
        } else {
          try {
            // Execute the query in read-only mode
            const results = await executeReadOnlyQuery(
              args.redactedUrl,
              dbUrlParam.password,
              args.query
            );

            // Format results for better display
            const formattedResults = JSON.stringify(results, null, 2);
            result = {
              content: '',
              systemMessage: `Here are the results of your SQL query:\n\`\`\`json\n${formattedResults}\n\`\`\`\nPlease use these results to answer the user's question.`,
              requiresReentry: true,
            };
          } catch (error) {
            console.error('Error executing query:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            result = { content: `\n\nError executing query: ${errorMessage}` };
          }
        }
        break;
      }

      case 'create_file': {
        const fileResult = await createFile(chatId, args.path, args.mime_type, args.content);
        result = {
          content: '',
          systemMessage: fileResult.success
            ? `I've created the file "${args.path}" with the following content:\n\`\`\`\n${args.content}\n\`\`\`\nPlease continue the conversation with this information.`
            : `I was unable to create file "${args.path}". Error: ${fileResult.error}\nPlease continue the conversation with this information.`,
          requiresReentry: true,
        };
        break;
      }

      case 'edit_file': {
        const fileResult = await editFile(chatId, args.path, args.content);
        result = {
          content: '',
          systemMessage: fileResult.success
            ? `I've updated the file "${args.path}" with the following content:\n\`\`\`\n${args.content}\n\`\`\`\nPlease continue the conversation with this information.`
            : `I was unable to update file "${args.path}". Error: ${fileResult.error}\nPlease continue the conversation with this information.`,
          requiresReentry: true,
        };
        break;
      }

      case 'delete_file': {
        const fileResult = await deleteFile(chatId, args.path);
        result = {
          content: '',
          systemMessage: fileResult.success
            ? `I've successfully deleted the file "${args.path}". Please continue the conversation with this information.`
            : `I was unable to delete file "${args.path}". Error: ${fileResult.error}\nPlease continue the conversation with this information.`,
          requiresReentry: true,
        };
        break;
      }

      case 'rename_file': {
        const fileResult = await renameFile(chatId, args.old_path, args.new_path);
        result = {
          content: '',
          systemMessage: fileResult.success
            ? `I've successfully renamed "${args.old_path}" to "${args.new_path}". Please continue the conversation with this information.`
            : `I was unable to rename file from "${args.old_path}" to "${args.new_path}". Error: ${fileResult.error}\nPlease continue the conversation with this information.`,
          requiresReentry: true,
        };
        break;
      }

      case 'read_file': {
        const fileResult = await readFile(chatId, args.path);
        result = {
          content: '',
          systemMessage:
            fileResult.success && fileResult.file
              ? `Here's the contents of "${args.path}":\n\`\`\`\n${fileResult.file.content}\n\`\`\`\nPlease continue the conversation with this information.`
              : `I was unable to read file "${args.path}". Error: ${fileResult.error}\nPlease continue the conversation with this information.`,
          requiresReentry: true,
        };
        break;
      }

      case 'rename_chat': {
        const newName = await renameChat(chatId, args.context);
        result = {
          content: newName
            ? `\n\nI've renamed this chat to: "${newName}"`
            : '\n\nFailed to rename chat.',
        };
        break;
      }

      case 'rename_chat_to': {
        const newName = await renameChatTo(chatId, args.name);
        result = {
          content: newName
            ? `\n\nI've renamed this chat to: "${newName}"`
            : '\n\nFailed to rename chat.',
        };
        break;
      }

      case 'pin_chat': {
        const success = await pinChat(chatId, args.pinned);
        result = {
          content: success
            ? `\n\nI've ${args.pinned ? 'pinned' : 'unpinned'} this chat.`
            : '\n\nFailed to update pin status.',
        };
        break;
      }

      default:
        result = { content: `\n\nUnsupported tool call: ${toolCall.function.name}` };
    }

    // Clear the thinking text
    await db`
      UPDATE messages
      SET thinking_text = ''
      WHERE id = ${messageId}
    `;

    return result;
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
  dbUrlParam?: { redactedUrl: string; redactedId: string; password: string }
) {
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
  const tools = [...basicTools, ...electricTools, ...fileTools, ...postgresTools];

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
      const result = await processToolCall(toolCall, chatId, messageId, dbUrlParam);

      // Add any direct content to the response
      if (result.content) {
        fullContent += result.content;
        tokenBuffer += result.content;
      }

      // If the tool requires re-entry into the stream with context
      if (result.requiresReentry && result.systemMessage) {
        // Add the context as a system message
        messages.push({
          role: 'system',
          content: result.systemMessage,
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
        const streamResult = await processStreamChunks(
          completion,
          messageId,
          tokenNumber,
          tokenBuffer,
          lastInsertTime
        );

        fullContent += streamResult.fullContent;
        tokenNumber = streamResult.tokenNumber;
        tokenBuffer = streamResult.tokenBuffer;
        lastInsertTime = streamResult.lastInsertTime;
      }
    }
  } catch (error) {
    console.error('Error processing AI stream:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    fullContent += `\n\nError processing AI stream: ${errorMessage}`;
    tokenBuffer += `\n\nError processing AI stream: ${errorMessage}`;
  }

  // Update the message with the processed content
  await db`
    UPDATE messages
    SET status = 'completed', content = ${fullContent}
    WHERE id = ${messageId}
  `;

  // Delete tokens
  await db`DELETE FROM tokens WHERE message_id = ${messageId}`;
}
