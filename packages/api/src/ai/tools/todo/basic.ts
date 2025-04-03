import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { db } from '../../../db.js';
import { ToolHandler } from '../../../types.js';
import crypto from 'crypto';
import { recordAction, ActionRelationship, levenshteinDistance } from '../../../utils.js';
import { TodoList, TodoItem } from './types.js';

// Define the Todo List tools
export const todoTools: ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'list_todo_lists',
      description: 'List all available todo lists',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_todo_items',
      description: 'Get all todo items from a specific todo list',
      parameters: {
        type: 'object',
        properties: {
          list_id: {
            type: 'string',
            description: 'The ID of the todo list to fetch items from',
          },
        },
        required: ['list_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_todo_list',
      description: 'Create a new todo list',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the new todo list',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'rename_todo_list',
      description: 'Rename an existing todo list',
      parameters: {
        type: 'object',
        properties: {
          list_id: {
            type: 'string',
            description: 'The ID of the todo list to rename',
          },
          name: {
            type: 'string',
            description: 'The new name for the todo list',
          },
        },
        required: ['list_id', 'name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_todo_list',
      description: 'Delete a todo list and all its items',
      parameters: {
        type: 'object',
        properties: {
          list_id: {
            type: 'string',
            description: 'The ID of the todo list to delete',
          },
        },
        required: ['list_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_todo_item',
      description: 'Create a new todo item in a specific list',
      parameters: {
        type: 'object',
        properties: {
          list_id: {
            type: 'string',
            description: 'The ID of the todo list to add the item to',
          },
          task: {
            type: 'string',
            description: 'The task text for the new todo item',
          },
        },
        required: ['list_id', 'task'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_todo_item',
      description: 'Update an existing todo item',
      parameters: {
        type: 'object',
        properties: {
          item_id: {
            type: 'string',
            description: 'The ID of the todo item to update',
          },
          task: {
            type: 'string',
            description: 'The new task text (optional)',
          },
          done: {
            type: 'boolean',
            description: 'Whether the task is complete (optional)',
          },
        },
        required: ['item_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_todo_item',
      description: 'Delete a todo item',
      parameters: {
        type: 'object',
        properties: {
          item_id: {
            type: 'string',
            description: 'The ID of the todo item to delete',
          },
        },
        required: ['item_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_todo_state',
      description:
        'Get the complete state of all todo lists and their items. Use this to understand the current context before performing operations, especially when references like "that" or "it" are used.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// ======== Helper functions for the tool handlers ========

// List all todo lists
async function listTodoLists(): Promise<{
  success: boolean;
  todoLists?: TodoList[];
  error?: string;
}> {
  try {
    const todoLists = await db`
      SELECT id, name, created_at, updated_at
      FROM todo_lists
      ORDER BY created_at DESC
    `;
    // Convert database rows to TodoList objects
    return { success: true, todoLists: todoLists as unknown as TodoList[] };
  } catch (error) {
    console.error('Error listing todo lists:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Get todo items for a specific list
async function getTodoItems(
  listId: string
): Promise<{ success: boolean; todoItems?: TodoItem[]; error?: string }> {
  try {
    // Check if the list exists first
    const [list] = await db`
      SELECT id FROM todo_lists WHERE id = ${listId}
    `;

    if (!list) {
      return { success: false, error: `Todo list with ID ${listId} not found` };
    }

    const todoItems = await db`
      SELECT id, list_id, task, done, order_key, created_at, updated_at
      FROM todo_items
      WHERE list_id = ${listId}
      ORDER BY created_at ASC
    `;
    // Convert database rows to TodoItem objects
    return { success: true, todoItems: todoItems as unknown as TodoItem[] };
  } catch (error) {
    console.error('Error getting todo items:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Create a new todo list
async function createTodoList(
  name: string
): Promise<{ success: boolean; todoList?: TodoList; error?: string }> {
  try {
    // Generate a unique ID for the todo list
    const listId = crypto.randomUUID();

    const [todoList] = await db`
      INSERT INTO todo_lists (id, name)
      VALUES (${listId}, ${name})
      RETURNING id, name, created_at, updated_at
    `;
    // Convert database row to TodoList object
    return { success: true, todoList: todoList as unknown as TodoList };
  } catch (error) {
    console.error('Error creating todo list:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Rename a todo list
async function renameTodoList(
  listId: string,
  name: string
): Promise<{ success: boolean; todoList?: TodoList; error?: string }> {
  try {
    // Check if the list exists first
    const [existingList] = await db`
      SELECT id FROM todo_lists WHERE id = ${listId}
    `;

    if (!existingList) {
      return { success: false, error: `Todo list with ID ${listId} not found` };
    }

    const [todoList] = await db`
      UPDATE todo_lists
      SET name = ${name}, updated_at = NOW()
      WHERE id = ${listId}
      RETURNING id, name, created_at, updated_at
    `;
    // Convert database row to TodoList object
    return { success: true, todoList: todoList as unknown as TodoList };
  } catch (error) {
    console.error('Error renaming todo list:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Delete a todo list
async function deleteTodoList(listId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if the list exists first
    const [existingList] = await db`
      SELECT id FROM todo_lists WHERE id = ${listId}
    `;

    if (!existingList) {
      return { success: false, error: `Todo list with ID ${listId} not found` };
    }

    // Delete all items in the list first (due to foreign key constraints)
    await db`
      DELETE FROM todo_items WHERE list_id = ${listId}
    `;

    // Delete the list itself
    await db`
      DELETE FROM todo_lists WHERE id = ${listId}
    `;
    return { success: true };
  } catch (error) {
    console.error('Error deleting todo list:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Create a new todo item
async function createTodoItem(
  listId: string,
  task: string
): Promise<{ success: boolean; todoItem?: TodoItem; error?: string }> {
  try {
    // Validate the list_id parameter
    if (!listId || listId.trim() === '') {
      return { success: false, error: 'A valid list_id is required to create a todo item' };
    }

    // Check if the list exists first
    const [existingList] = await db`
      SELECT id FROM todo_lists WHERE id = ${listId}
    `;

    if (!existingList) {
      return {
        success: false,
        error: `Todo list with ID ${listId} not found. Use the list_todo_lists tool to get valid list IDs.`,
      };
    }

    // Generate a timestamp-based order key for simplicity
    const orderKey = new Date().getTime().toString();

    // Generate a unique item ID
    const itemId = crypto.randomUUID();

    // Create the todo item with an explicit ID
    const [todoItem] = await db`
      INSERT INTO todo_items (id, list_id, task, done, order_key)
      VALUES (${itemId}, ${listId}, ${task}, false, ${orderKey})
      RETURNING id, list_id, task, done, order_key, created_at, updated_at
    `;

    // Convert database row to TodoItem object
    return { success: true, todoItem: todoItem as unknown as TodoItem };
  } catch (error) {
    console.error('Error creating todo item:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Update a todo item
async function updateTodoItem(
  itemId: string,
  updates: { task?: string; done?: boolean }
): Promise<{ success: boolean; todoItem?: TodoItem; error?: string }> {
  try {
    // Check if the item exists first
    const [existingItem] = await db`
      SELECT id FROM todo_items WHERE id = ${itemId}
    `;

    if (!existingItem) {
      return { success: false, error: `Todo item with ID ${itemId} not found` };
    }

    // Build update object based on provided fields
    const updateFields: Record<string, any> = { updated_at: new Date() };
    if (updates.task !== undefined) updateFields.task = updates.task;
    if (updates.done !== undefined) updateFields.done = updates.done;

    const [todoItem] = await db`
      UPDATE todo_items
      SET ${db(updateFields)}
      WHERE id = ${itemId}
      RETURNING id, list_id, task, done, order_key, created_at, updated_at
    `;
    // Convert database row to TodoItem object
    return { success: true, todoItem: todoItem as unknown as TodoItem };
  } catch (error) {
    console.error('Error updating todo item:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Delete a todo item
async function deleteTodoItem(itemId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if the item exists first
    const [existingItem] = await db`
      SELECT id FROM todo_items WHERE id = ${itemId}
    `;

    if (!existingItem) {
      return { success: false, error: `Todo item with ID ${itemId} not found` };
    }

    await db`
      DELETE FROM todo_items WHERE id = ${itemId}
    `;
    return { success: true };
  } catch (error) {
    console.error('Error deleting todo item:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Get the complete todo state (all lists and items)
async function getTodoState(): Promise<{
  success: boolean;
  todoLists?: TodoList[];
  todoItems?: { list: TodoList; items: TodoItem[] }[];
  error?: string;
}> {
  try {
    // Get all lists
    const todoLists = await db`
      SELECT id, name, created_at, updated_at
      FROM todo_lists
      ORDER BY created_at DESC
    `;

    // For each list, get its items
    const listsWithItems = [];
    for (const list of todoLists) {
      const items = await db`
        SELECT id, list_id, task, done, order_key, created_at, updated_at
        FROM todo_items
        WHERE list_id = ${list.id}
        ORDER BY created_at ASC
      `;

      listsWithItems.push({
        list,
        items,
      });
    }

    return {
      success: true,
      todoLists: todoLists as unknown as TodoList[],
      todoItems: listsWithItems as unknown as { list: TodoList; items: TodoItem[] }[],
    };
  } catch (error) {
    console.error('Error getting todo state:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ======== Tool handlers ========

export const todoToolHandlers: ToolHandler[] = [
  {
    name: 'list_todo_lists',
    getThinkingText: () => 'Fetching all todo lists...',
    process: async (args, chatId, messageId, abortController) => {
      const result = await listTodoLists();

      if (result.success && result.todoLists) {
        const todoListsCount = result.todoLists.length;

        let content = '';

        if (todoListsCount === 0) {
          content = 'No todo lists found. You can create a new one with the create_todo_list tool.';
        } else {
          const formattedLists = result.todoLists.map(list => ({
            id: list.id,
            name: list.name,
            created_at: list.created_at,
          }));

          content = `Found ${todoListsCount} todo list(s):\n${JSON.stringify(formattedLists, null, 2)}`;
        }

        return {
          content: '',
          systemMessage: content,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Error fetching todo lists: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
    // Read operations are generally ok to repeat
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      // It's a read operation without arguments, so we'll allow repeats
      return false;
    },
  },
  {
    name: 'get_todo_items',
    getThinkingText: args =>
      `Fetching todo items from list ${(args as { list_id: string }).list_id}...`,
    process: async (args, chatId, messageId, abortController) => {
      const { list_id } = args as { list_id: string };

      const result = await getTodoItems(list_id);

      if (result.success && result.todoItems) {
        const todoItemsCount = result.todoItems.length;

        let content = '';

        if (todoItemsCount === 0) {
          content =
            'No todo items found in this list. You can create a new one with the create_todo_item tool.';
        } else {
          const formattedItems = result.todoItems.map(item => ({
            id: item.id,
            task: item.task,
            done: item.done,
          }));

          content = `Found ${todoItemsCount} todo item(s) in list ${list_id}:\n${JSON.stringify(formattedItems, null, 2)}`;
        }

        return {
          content: '',
          systemMessage: content,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Error fetching todo items: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
    // Check if we're trying to get items from the same list repeatedly
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      const current = currentArgs as { list_id: string };
      const previous = previousArgs as { list_id: string };

      // Even for the same list_id, it's generally ok to refresh/repeat read operations
      // The data might have changed between calls
      return false;
    },
  },
  {
    name: 'create_todo_list',
    getThinkingText: args => `Creating new todo list "${(args as { name: string }).name}"...`,
    process: async (args, chatId, messageId, abortController) => {
      const { name } = args as { name: string };

      const result = await createTodoList(name);

      if (result.success && result.todoList) {
        // Record the action with the created list entity
        await recordAction(chatId, 'create_list', result.todoList.id, result.todoList.name);

        return {
          content: '',
          systemMessage: `Created new todo list: "${name}" with ID: ${result.todoList.id}`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Error creating todo list: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
    // Check if we're trying to create a list with the same name
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      const current = currentArgs as { name: string };
      const previous = previousArgs as { name: string };

      return Boolean(
        current.name && previous.name && current.name.toLowerCase() === previous.name.toLowerCase()
      );
    },
  },
  {
    name: 'rename_todo_list',
    getThinkingText: args => {
      const typedArgs = args as { list_id: string; name: string };
      return `Renaming todo list ${typedArgs.list_id} to "${typedArgs.name}"...`;
    },
    process: async (args, chatId, messageId, abortController) => {
      const { list_id, name } = args as { list_id: string; name: string };

      const result = await renameTodoList(list_id, name);

      if (result.success && result.todoList) {
        // Record the action with the renamed list entity
        await recordAction(chatId, 'update_list', result.todoList.id, result.todoList.name);

        return {
          content: '',
          systemMessage: `Renamed todo list ${list_id} to "${name}"`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Error renaming todo list: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
    // Check if we're trying to rename a list with the same ID to the same name
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      const current = currentArgs as { list_id: string; name: string };
      const previous = previousArgs as { list_id: string; name: string };

      return Boolean(
        current.list_id === previous.list_id &&
          current.name &&
          previous.name &&
          current.name.toLowerCase() === previous.name.toLowerCase()
      );
    },
  },
  {
    name: 'delete_todo_list',
    getThinkingText: args => `Deleting todo list ${(args as { list_id: string }).list_id}...`,
    process: async (args, chatId, messageId, abortController) => {
      const { list_id } = args as { list_id: string };

      // Get the list name before deleting for better context
      const listResult = await listTodoLists();
      let listName = 'unknown';
      if (listResult.success && listResult.todoLists) {
        const targetList = listResult.todoLists.find(list => list.id === list_id);
        if (targetList) {
          listName = targetList.name;
        }
      }

      const result = await deleteTodoList(list_id);

      if (result.success) {
        // Record the action with the deleted list entity
        await recordAction(chatId, 'delete_list', list_id, listName);

        return {
          content: '',
          systemMessage: `Deleted todo list "${listName}" (ID: ${list_id})`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Error deleting todo list: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
    // Check if we're trying to delete the same list
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      const current = currentArgs as { list_id: string };
      const previous = previousArgs as { list_id: string };

      return Boolean(current.list_id === previous.list_id);
    },
  },
  {
    name: 'create_todo_item',
    getThinkingText: args => {
      const typedArgs = args as { list_id: string; task: string };
      return `Creating new todo item "${typedArgs.task}" in list ${typedArgs.list_id}...`;
    },
    process: async (args, chatId, messageId, abortController) => {
      const { list_id, task } = args as { list_id: string; task: string };

      // Get the list name for context
      const listResult = await listTodoLists();
      let listName = 'unknown';
      if (listResult.success && listResult.todoLists) {
        const targetList = listResult.todoLists.find(list => list.id === list_id);
        if (targetList) {
          listName = targetList.name;
        }
      }

      const result = await createTodoItem(list_id, task);

      if (result.success && result.todoItem) {
        // Record the action with the created item entity and its parent list relationship
        const relationships: ActionRelationship[] = [
          { type: 'belongs_to_list', id: list_id, name: listName },
        ];

        await recordAction(chatId, 'create_item', result.todoItem.id, task, relationships);

        return {
          content: '',
          systemMessage: `Created new todo item: "${task}" with ID: ${result.todoItem.id} in list "${listName}"`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Error creating todo item: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
    // Check if we're trying to create a similar item in the same list
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      const current = currentArgs as { list_id: string; task: string };
      const previous = previousArgs as { list_id: string; task: string };

      // Check if same list and similar task text
      if (current.list_id === previous.list_id && current.task && previous.task) {
        // Exact match
        if (current.task.toLowerCase() === previous.task.toLowerCase()) {
          return true;
        }

        // Compute Levenshtein distance for fuzzy matching
        const distance = levenshteinDistance(current.task, previous.task);
        return distance < 3; // Consider similar if edit distance is small
      }

      return false;
    },
  },
  {
    name: 'update_todo_item',
    getThinkingText: args => `Updating todo item ${(args as { item_id: string }).item_id}...`,
    process: async (args, chatId, messageId, abortController) => {
      const { item_id, task, done } = args as { item_id: string; task?: string; done?: boolean };

      // Get the current item first for better context
      const listResult = await getTodoState();
      let itemName = 'unknown';
      let listId = '';
      let listName = 'unknown';

      if (listResult.success && listResult.todoItems) {
        for (const list of listResult.todoItems) {
          const targetItem = list.items.find(item => item.id === item_id);
          if (targetItem) {
            itemName = targetItem.task;
            listId = list.list.id;
            listName = list.list.name;
            break;
          }
        }
      }

      const updateType =
        done !== undefined
          ? done
            ? 'marked as done'
            : 'marked as not done'
          : task
            ? 'task text updated'
            : 'updated';

      const result = await updateTodoItem(item_id, { task, done });

      if (result.success && result.todoItem) {
        // Record the action with the updated item entity and its parent list relationship
        const relationships: ActionRelationship[] = [];
        if (listId) {
          relationships.push({ type: 'belongs_to_list', id: listId, name: listName });
        }

        await recordAction(
          chatId,
          'update_item',
          result.todoItem.id,
          result.todoItem.task,
          relationships
        );

        // Construct a message with update details
        let message = `Updated todo item "${itemName}" (ID: ${item_id}), ${updateType}`;

        return {
          content: '',
          systemMessage: message,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Error updating todo item: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
    // Check if we're trying to update the same item with the same values
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      const current = currentArgs as { item_id: string; task?: string; done?: boolean };
      const previous = previousArgs as { item_id: string; task?: string; done?: boolean };

      // Check if same item ID
      if (current.item_id !== previous.item_id) {
        return false;
      }

      // If updating task text, check if it's the same
      if (
        current.task !== undefined &&
        previous.task !== undefined &&
        current.task.toLowerCase() === previous.task.toLowerCase()
      ) {
        return true;
      }

      // If updating done status, check if it's the same
      if (
        current.done !== undefined &&
        previous.done !== undefined &&
        current.done === previous.done
      ) {
        return true;
      }

      return false;
    },
  },
  {
    name: 'delete_todo_item',
    getThinkingText: args => `Deleting todo item ${(args as { item_id: string }).item_id}...`,
    process: async (args, chatId, messageId, abortController) => {
      const { item_id } = args as { item_id: string };

      // Get the current item first for better context
      const listResult = await getTodoState();
      let itemName = 'unknown';
      let listId = '';
      let listName = 'unknown';

      if (listResult.success && listResult.todoItems) {
        for (const list of listResult.todoItems) {
          const targetItem = list.items.find(item => item.id === item_id);
          if (targetItem) {
            itemName = targetItem.task;
            listId = list.list.id;
            listName = list.list.name;
            break;
          }
        }
      }

      const result = await deleteTodoItem(item_id);

      if (result.success) {
        // Record the action with the deleted item entity and its parent list relationship
        const relationships: ActionRelationship[] = [];
        if (listId) {
          relationships.push({ type: 'belongs_to_list', id: listId, name: listName });
        }

        await recordAction(chatId, 'delete_item', item_id, itemName, relationships);

        return {
          content: '',
          systemMessage: `Deleted todo item "${itemName}" (ID: ${item_id}) from list "${listName}"`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Error deleting todo item: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
    // Check if we're trying to delete the same item
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      const current = currentArgs as { item_id: string };
      const previous = previousArgs as { item_id: string };

      return Boolean(current.item_id === previous.item_id);
    },
  },
  {
    name: 'get_todo_state',
    getThinkingText: () => 'Fetching complete todo state...',
    process: async (args, chatId, messageId, abortController) => {
      const result = await getTodoState();

      if (result.success && result.todoLists && result.todoItems) {
        const todoListsCount = result.todoLists.length;
        const todoItemsCount = result.todoItems.reduce(
          (count, list) => count + list.items.length,
          0
        );

        let content = '';

        if (todoListsCount === 0) {
          content = 'No todo lists found. You can create a new one with the create_todo_list tool.';
        } else {
          content = `Found ${todoListsCount} todo list(s) with a total of ${todoItemsCount} item(s):\n\n`;

          for (const list of result.todoItems) {
            content += `List: "${list.list.name}" (ID: ${list.list.id})\n`;

            if (list.items.length === 0) {
              content += '  No items in this list.\n\n';
            } else {
              for (const item of list.items) {
                content += `  ${item.done ? '[✓]' : '[ ]'} "${item.task}" (ID: ${item.id})\n`;
              }
              content += '\n';
            }
          }
        }

        return {
          content: '',
          systemMessage: content,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Error fetching todo state: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
    // Check if we're calling get_todo_state too frequently
    // For read operations we generally don't need to warn about duplicates unless
    // they happen in quick succession
    checkIfSimilar: (currentArgs: unknown, previousArgs: unknown): boolean => {
      // Read operation is generally ok to repeat, but we'll consider it similar
      // if called twice with the same (empty) arguments
      // Our fallback will handle this based on time between calls
      return false;
    },
  },
];
