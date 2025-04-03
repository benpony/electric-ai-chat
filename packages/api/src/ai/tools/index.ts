import { ToolCall, ToolHandler } from '../../types.js';
import { db } from '../../db.js';
import { storeToolCall, detectSimilarToolCalls, storeSystemMessage } from '../../utils.js';
import { todoToolHandlers } from './todo/index.js';
import { basicToolHandlers } from './basic.js';
import { fileToolHandlers } from './files.js';
import { electricToolHandlers } from './electric.js';
import { postgresToolHandlers } from './postgres.js';

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

export interface ProcessToolCallParams {
  toolCall: ToolCall;
  chatId: string;
  messageId: string;
  abortController: AbortController;
  dbUrlParam?: { redactedUrl: string; redactedId: string; password: string };
}

export async function processToolCall({
  toolCall,
  chatId,
  messageId,
  abortController,
  dbUrlParam,
}: ProcessToolCallParams): Promise<{
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
      SET thinking_text = ${thinkingText},
          updated_at = NOW()
      WHERE id = ${messageId}
    `;

    try {
      // Process the tool call
      const result = await handler.process(args, chatId, messageId, abortController, dbUrlParam);

      // Clear the thinking text
      await db`
        UPDATE messages
        SET thinking_text = '',
            updated_at = NOW()
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
        SET thinking_text = '',
            updated_at = NOW()
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
      SET thinking_text = '',
          updated_at = NOW()
      WHERE id = ${messageId}
    `;

    return { content: `\n\nError processing tool call: ${errorMessage}` };
  }
}
