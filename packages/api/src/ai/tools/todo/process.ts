import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { db } from '../../../db.js';
import { ToolHandler } from '../../../types.js';
import { recordAction } from '../../../utils.js';
import { Shape, ShapeStream } from '@electric-sql/client';
import { randomUUID } from 'crypto';
import { ELECTRIC_API_URL } from '../../../urls.js';

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

// Helper function for processing todo list items
async function processTodoListItems(
  listId: string,
  chatId: string,
  messageId: string,
  abortSignal: AbortSignal,
  watchMode: boolean = false
): Promise<{ status: string; completedTasks: string[]; abortedTasks: string[] }> {
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

    // Record when we start to know we've processed everything once
    let initialProcessingComplete = false;

    // Subscribe to changes in the todo items
    listItemsShape.subscribe(
      async ({
        rows,
      }: {
        rows: Array<{
          id: string;
          list_id: string;
          task: string;
          done: boolean;
        }>;
      }) => {
        try {
          // Process new and updated items
          for (const item of rows) {
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
              SET thinking_text = ${`Processing task: "${item.task}"...`},
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
              // Wait a bit to simulate processing time
              // DOING SOME BIG WORK THINGS HERE.....
              await new Promise(resolve => setTimeout(resolve, 1000));

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

              // Send a message about the completed task
              const taskMessage = randomUUID();
              await db`
                INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at, updated_at)
                VALUES (
                  ${taskMessage},
                  ${chatId},
                  ${`✓ Completed task: "${item.task}" in list "${listName}"`},
                  'AI Assistant',
                  'agent',
                  'completed',
                  NOW(),
                  NOW()
                )
              `;
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

          // Check if we've completed initial processing
          if (!initialProcessingComplete && rows.length > 0 && inProgressTaskIds.size === 0) {
            initialProcessingComplete = true;

            // If not in watch mode, we're done after initial processing
            if (!watchMode) {
              return finish('completed');
            }
          }

          // Update thinking text to say we're watching
          await db`
            UPDATE messages
            SET thinking_text = 'Watching for changes...', updated_at = NOW()
            WHERE id = ${messageId}
          `;
        } catch (err) {
          streamAbortController.abort();
          reject(err);
        }
      }
    );
  });
}

// ======== Tool handlers ========

export const todoToolHandlers: ToolHandler[] = [
  {
    name: 'process_todo_list',
    getThinkingText: args => `Processing todo list ${(args as { list_id: string }).list_id}...`,
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

        // Create an abort controller for the process
        const abortController = new AbortController();

        // Start processing in the background
        const processingPromise = processTodoListItems(
          list_id,
          chatId,
          messageId,
          abortController.signal,
          false // Not in watch mode
        );

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
        const processingPromise = processTodoListItems(
          list_id,
          chatId,
          messageId,
          abortController.signal,
          true // Watch mode
        );

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
