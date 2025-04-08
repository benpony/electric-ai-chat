import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { db } from '../../../db.js';
import { ToolHandler } from '../../../types.js';
import { recordAction, rowToChatMessage } from '../../../utils.js';
import { Shape, ShapeStream } from '@electric-sql/client';
import { randomUUID } from 'crypto';
import { ELECTRIC_API_URL } from '../../../urls.js';
import { processAIStream } from '../../stream.js';

interface TodoItem {
  id: string;
  list_id: string;
  task: string;
  done: boolean;
}

// Define the Todo List tools
export const todoTools: ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'process_todo_list',
      description:
        'Reads a todo list and automatically performs all the tasks in it until completion. Subscribes to the list to detect changes, and will abort tasks that are marked as done during processing.',
      parameters: {
        type: 'object',
        properties: {
          list_id: {
            type: 'string',
            description: 'The ID of the todo list to process',
          },
        },
        required: ['list_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'watch_and_process_todo_list',
      description:
        'Watches a todo list for new items and processes them automatically. Continues running until the conversation ends, processing both existing and new tasks as they are added.',
      parameters: {
        type: 'object',
        properties: {
          list_id: {
            type: 'string',
            description: 'The ID of the todo list to watch and process',
          },
        },
        required: ['list_id'],
      },
    },
  },
];

// ======== Helper functions for the tool handlers ========

interface ProcessTodoListItemParams {
  listId: string;
  chatId: string;
  messageId: string;
  item: TodoItem;
  abortSignal: AbortSignal;
}

async function processTodoListItem({
  listId,
  chatId,
  messageId,
  item,
  abortSignal,
}: ProcessTodoListItemParams): Promise<void> {
  console.log(`Processing task: ${item.task}`);

  // Insert a "user" message about the task
  await db`
    INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at, updated_at)
    VALUES (
      ${randomUUID()},
      ${chatId},
      ${`You are working through a todo list. Please perform the following task:

${item.task}

This is to be interpreted exactly as though it is a message from the user.
For example if the user is asked to "write a story about a cat", you should respond with the story.
Or if asked to "create a to do app with Electric" you would respond with the code for the app.
If asked to "save the files" *then* you would use the save_file tool.
Please only use tools that are relevant to the task.
Do let the user know what the task is that you are working on, but do not ask the user to do anything. 
Also do not ask if there is anything else they would like you to do.
`},
      'Task Assistant',
      'system',
      'completed',
      NOW(),
      NOW()
    )
  `;

  // Get the messages
  const rawMessages = await db`
    SELECT 
      m.id, 
      CASE 
        WHEN m.status = 'pending' AND tokens_content IS NOT NULL THEN tokens_content
        ELSE m.content
      END as content,
      m.user_name, 
      m.role, 
      m.status, 
      m.created_at, 
      m.updated_at
    FROM messages m
    LEFT JOIN LATERAL (
      SELECT string_agg(token_text, '') as tokens_content
      FROM tokens 
      WHERE message_id = m.id
      GROUP BY message_id
    ) t ON m.status = 'pending'
    WHERE m.chat_id = ${chatId}
    ORDER BY m.created_at ASC
  `;

  // Insert a "assistant" message about the task
  const assistantMessageId = randomUUID();
  await db`
    INSERT INTO messages (id, chat_id, user_name, role, status, thinking_text, created_at, updated_at)
    VALUES (
      ${assistantMessageId},
      ${chatId},
      'Task Assistant',
      'agent',
      'pending',
      ${`Thinking about task...`},
      NOW(),
      NOW()
    )
  `;

  // Preprocess the messages
  const messages = rawMessages.sort((a, b) => {
    // If both messages are from agent, compare by updated_at
    // if (a.role === 'agent' && b.role === 'agent') {
    //   const timeA = a.updated_at.getTime();
    //   const timeB = b.updated_at.getTime();
    //   if (timeA === timeB) {
    //     // If timestamps equal, pending messages come after non-pending
    //     if (a.status === 'pending' && b.status !== 'pending') return 1;
    //     if (a.status !== 'pending' && b.status === 'pending') return -1;
    //   }
    //   return timeA - timeB;
    // }
    // Otherwise compare by created_at
    return a.updated_at.getTime() - b.updated_at.getTime();
  });
  const context = messages.map(rowToChatMessage);

  // Remove the last message if it is a assistant a with no content
  if (
    messages[messages.length - 1].role === 'agent' &&
    messages[messages.length - 1].content === ''
  ) {
    context.pop();
  }

  // Insert a system message about the task in the n-1 position
  // context.splice(context.length - 1, 0, {
  //   role: 'system',
  //   content: `You need to perform the task in the next message. This is to be interpreted as though it is a message from the user.\n\nDO NOT USE THE update_todo_item OR delete_todo_item TOOLS TO MARK A TASK AS DONE - THIS IS VERY IMPORTANT!`,
  // });

  // Process the task
  console.log('>>> processing task');
  await processAIStream({
    chatId,
    messageId: assistantMessageId,
    context,
    recursionDepth: 0,
    excludeTools: [/todo/, /chat/],
  });
  console.log('>>> done processing task');
  // Update the assistant message to say we're done
  // await db`
  //   UPDATE messages
  //   SET content = ${`this would be the output of the task`},
  //       status = 'completed',
  //       updated_at = NOW()
  //   WHERE id = ${assistantMessageId}
  // `;
}

interface ProcessTodoListItemsParams {
  listId: string;
  chatId: string;
  messageId: string;
  abortSignal: AbortSignal;
  watchMode?: boolean;
}

async function processTodoListItems({
  listId,
  chatId,
  messageId,
  abortSignal,
  watchMode = false,
}: ProcessTodoListItemsParams): Promise<{
  status: string;
  completedTasks: string[];
  abortedTasks: string[];
}> {
  return new Promise((resolve, reject) => {
    // This will be our return data
    const result = {
      status: 'completed',
      completedTasks: [] as string[],
      abortedTasks: [] as string[],
    };

    // This is a local abort controller that we can use to abort the process
    // this allows us to abort the shape stream cleanly without affecting the
    // overall message state
    const streamAbortController = new AbortController();

    // Finish handler - called when the process is complete or aborted
    function finish(status: string = 'completed') {
      streamAbortController.abort();
      resolve({ ...result, status });
    }
    abortSignal.addEventListener('abort', () => {
      // If the outer abort controller is aborted, we need to finish the process
      finish('aborted');
    });

    // Create a shape stream to subscribe to the todo list items
    const listItemsStream = new ShapeStream<{
      id: string;
      list_id: string;
      task: string;
      done: boolean;
    }>({
      url: `${ELECTRIC_API_URL}/v1/shape`,
      params: {
        table: 'todo_items',
        where: `list_id = '${listId}'`,
        columns: ['id', 'list_id', 'task', 'done'],
      },
      signal: streamAbortController.signal,
    });

    // Create a shape to track the items
    const listItemsShape = new Shape(listItemsStream);

    // Track which tasks we've processed or are currently processing
    const processedTaskIds = new Set<string>();
    const inProgressTaskIds = new Set<string>();

    // We only want processItems once at a time.
    let processingItems = false;

    function nextItem() {
      return listItemsShape.currentRows.filter(
        item => !processedTaskIds.has(item.id) && !inProgressTaskIds.has(item.id) && !item.done
      )[0];
    }

    async function processItems() {
      if (processingItems) return;
      processingItems = true;

      try {
        // Process new and updated items
        while (true) {
          const item = nextItem();
          if (!item) {
            // If not in watch mode, we're done after initial processing
            if (!watchMode) {
              return finish('completed');
            } else {
              // If in watch mode, we need to wait for the next item
              // Update thinking text to say we're watching
              await db`
                UPDATE messages
                SET thinking_text = 'Watching for changes to list...', updated_at = NOW()
                WHERE id = ${messageId}
              `;
              break;
            }
          }

          // Skip if already processed
          if (processedTaskIds.has(item.id)) continue;

          // If the item is already done, mark as processed and skip
          if (item.done) {
            processedTaskIds.add(item.id);
            continue;
          }

          // If we're already working on this task, skip
          if (inProgressTaskIds.has(item.id)) continue;

          // Mark as in progress
          inProgressTaskIds.add(item.id);

          // Process the task
          console.log(`Processing task: ${item.task}`);

          // Update thinking text for specific task
          await db`
              UPDATE messages
              SET thinking_text = ${`Processing task: "${item.task.slice(0, 80)}..."`},
                  updated_at = NOW()
              WHERE id = ${messageId}
            `;

          // Check if the item has been marked as done (by checking again)
          const [updatedItem] = await db`
              SELECT id, done FROM todo_items WHERE id = ${item.id}
            `;

          if (updatedItem && updatedItem.done) {
            // Task completed by someone else
            inProgressTaskIds.delete(item.id);
            processedTaskIds.add(item.id);
            result.abortedTasks.push(item.task);
            continue;
          }

          try {
            // Process the task
            await processTodoListItem({
              listId,
              chatId,
              messageId,
              item,
              abortSignal,
            });

            // Mark task as done
            await db`
                UPDATE todo_items
                SET done = true, updated_at = NOW()
                WHERE id = ${item.id}
              `;

            // Record the action
            const listName =
              (
                await db`
                    SELECT name FROM todo_lists WHERE id = ${listId}
                  `
              )[0]?.name || 'unknown';

            const relationships = [{ type: 'belongs_to_list', id: listId, name: listName }];

            await recordAction(chatId, 'complete_item', item.id, item.task, relationships);

            // Add to completed tasks
            result.completedTasks.push(item.task);
          } catch (taskError) {
            console.error(`Error processing task "${item.task}":`, taskError);

            // Update the task with an error note
            await db`
                UPDATE todo_items
                SET task = ${`${item.task} [ERROR: ${taskError instanceof Error ? taskError.message : 'Processing failed'}]`}
                WHERE id = ${item.id}
              `;

            // Send a message about the failed task
            const errorMessage = randomUUID();
            await db`
                INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at, updated_at)
                VALUES (
                  ${errorMessage},
                  ${chatId},
                  ${`❌ Failed to process task: "${item.task}" - ${taskError instanceof Error ? taskError.message : 'Processing failed'}`},
                  'AI Assistant',
                  'agent',
                  'completed',
                  NOW(),
                  NOW()
                )
              `;
          } finally {
            // Remove from in progress
            inProgressTaskIds.delete(item.id);

            // Mark as processed regardless of success/failure
            processedTaskIds.add(item.id);

            // Update thinking text to be empty
            await db`
                UPDATE messages
                SET thinking_text = '', updated_at = NOW()
                WHERE id = ${messageId}
              `;
          }
        }
      } catch (err) {
        streamAbortController.abort();
        reject(err);
      } finally {
        processingItems = false;
      }
    }

    // Subscribe to changes in the todo items
    listItemsShape.subscribe(async () => {
      processItems();
    });
  });
}

// ======== Tool handlers ========

export const todoToolHandlers: ToolHandler[] = [
  {
    name: 'process_todo_list',
    getThinkingText: args => `Processing todo list ${(args as { list_id: string }).list_id}...`,
    process: async (args, chatId, messageId, abortController) => {
      const { list_id } = args as { list_id: string };

      if (!list_id) {
        return {
          content: '',
          systemMessage: 'Error: No list ID provided - please provide a list ID',
          requiresReentry: true,
        };
      }

      try {
        // Verify the list exists
        const [list] = await db`
          SELECT id, name FROM todo_lists WHERE id = ${list_id}
        `;

        if (!list) {
          return {
            content: '',
            systemMessage: `Error: Todo list with ID ${list_id} not found`,
            requiresReentry: true,
          };
        }

        // Create an abort controller for the process
        const abortController = new AbortController();

        // Start processing in the background
        const processingPromise = processTodoListItems({
          listId: list_id,
          chatId,
          messageId,
          abortSignal: abortController.signal,
          watchMode: false,
        });

        // Set a timeout to abort after a reasonable time
        const timeoutId = setTimeout(
          () => {
            abortController.abort();
          },
          5 * 60 * 1000
        ); // 5 minutes max

        // Wait for the processing to complete
        const result = await processingPromise;

        // Clear the timeout
        clearTimeout(timeoutId);

        // Construct the response
        let responseMessage = '';

        if (result.status === 'aborted') {
          responseMessage = `Processing of todo list "${list.name}" was aborted.`;
        } else {
          responseMessage = `Completed processing todo list "${list.name}".`;
        }

        if (result.completedTasks.length > 0) {
          responseMessage += `\n\nCompleted ${result.completedTasks.length} tasks:`;
          result.completedTasks.forEach(task => {
            responseMessage += `\n- "${task}"`;
          });
        } else {
          responseMessage += '\n\nNo tasks were completed.';
        }

        if (result.abortedTasks.length > 0) {
          responseMessage += `\n\n${result.abortedTasks.length} tasks were already completed or marked as done during processing:`;
          result.abortedTasks.forEach(task => {
            responseMessage += `\n- "${task}"`;
          });
        }

        return {
          content: '',
          systemMessage: responseMessage,
          requiresReentry: true,
        };
      } catch (error) {
        console.error('Error in process_todo_list:', error);
        return {
          content: '',
          systemMessage: `Error processing todo list: ${error instanceof Error ? error.message : 'Unknown error'}`,
          requiresReentry: true,
        };
      }
    },
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      const current = currentArgs as { list_id: string };
      const previous = previousArgs as { list_id: string };

      // Consider processing the same list as similar
      return Boolean(current.list_id === previous.list_id);
    },
  },
  {
    name: 'watch_and_process_todo_list',
    getThinkingText: args =>
      `Watching and processing todo list ${(args as { list_id: string }).list_id}...`,
    process: async (args, chatId, messageId, abortController) => {
      const { list_id } = args as { list_id: string };

      try {
        // Verify the list exists
        const [list] = await db`
          SELECT id, name FROM todo_lists WHERE id = ${list_id}
        `;

        if (!list) {
          return {
            content: '',
            systemMessage: `Error: Todo list with ID ${list_id} not found`,
            requiresReentry: true,
          };
        }

        // Start processing in the background
        const processingPromise = processTodoListItems({
          listId: list_id,
          chatId,
          messageId,
          abortSignal: abortController.signal,
          watchMode: true,
        });

        // Wait for the processing to complete
        const result = await processingPromise;

        // Construct the response
        let responseMessage = '';

        if (result.status === 'aborted') {
          responseMessage = `Processing of todo list "${list.name}" was aborted.`;
        } else {
          responseMessage = `Completed processing todo list "${list.name}".`;
        }

        if (result.completedTasks.length > 0) {
          responseMessage += `\n\nCompleted ${result.completedTasks.length} tasks:`;
          result.completedTasks.forEach(task => {
            responseMessage += `\n- "${task}"`;
          });
        } else {
          responseMessage += '\n\nNo tasks were completed.';
        }

        if (result.abortedTasks.length > 0) {
          responseMessage += `\n\n${result.abortedTasks.length} tasks were already completed or marked as done during processing:`;
          result.abortedTasks.forEach(task => {
            responseMessage += `\n- "${task}"`;
          });
        }

        return {
          content: '',
          systemMessage: responseMessage,
          requiresReentry: true,
        };
      } catch (error) {
        console.error('Error in process_todo_list:', error);
        return {
          content: '',
          systemMessage: `Error processing todo list: ${error instanceof Error ? error.message : 'Unknown error'}`,
          requiresReentry: true,
        };
      }
    },
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      const current = currentArgs as { list_id: string };
      const previous = previousArgs as { list_id: string };

      // Consider watching the same list as similar
      return Boolean(current.list_id === previous.list_id);
    },
  },
];
