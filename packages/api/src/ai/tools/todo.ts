import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { db } from '../../db.js';
import { ToolHandler } from '../../types.js';
import postgres from 'postgres';
import crypto from 'crypto';

// Define the Todo List and Todo Item types for internal use
interface TodoList {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

interface TodoItem {
  id: string;
  list_id: string;
  task: string;
  done: boolean;
  order_key: string;
  created_at: Date;
  updated_at: Date;
}

// Type for postgres.js row results
type Row = postgres.Row;

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
    const [todoList] = await db`
      INSERT INTO todo_lists (name)
      VALUES (${name})
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

// ======== Tool handlers ========

export const todoToolHandlers: ToolHandler[] = [
  {
    name: 'list_todo_lists',
    getThinkingText: () => 'Fetching all todo lists...',
    process: async () => {
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

          content = `Found ${todoListsCount} todo lists:\n\n${JSON.stringify(formattedLists, null, 2)}`;
        }

        return {
          content: '',
          systemMessage: content,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Failed to fetch todo lists: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
  },
  {
    name: 'get_todo_items',
    getThinkingText: (args: unknown) => {
      const { list_id } = args as { list_id?: string };

      if (!list_id) {
        return 'Error: No list_id provided for fetching todo items';
      }

      return `Fetching items for todo list: ${list_id}...`;
    },
    process: async (args: unknown) => {
      const { list_id } = args as { list_id?: string };

      if (!list_id) {
        return {
          content: '',
          systemMessage:
            'Error: You must provide a list_id to fetch todo items. Use the list_todo_lists tool to get a valid list ID first.',
          requiresReentry: true,
        };
      }

      const result = await getTodoItems(list_id);

      if (result.success && result.todoItems) {
        const todoItemsCount = result.todoItems.length;

        let content = '';

        if (todoItemsCount === 0) {
          content = `No items found in todo list with ID: ${list_id}. You can add items with the create_todo_item tool.`;
        } else {
          const formattedItems = result.todoItems.map(item => ({
            id: item.id,
            task: item.task,
            done: item.done,
            created_at: item.created_at,
          }));

          content = `Found ${todoItemsCount} items in todo list with ID: ${list_id}:\n\n${JSON.stringify(formattedItems, null, 2)}`;
        }

        return {
          content: '',
          systemMessage: content,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Failed to fetch todo items: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
  },
  {
    name: 'create_todo_list',
    getThinkingText: (args: unknown) => {
      const { name } = args as { name: string };
      return `Creating new todo list: ${name}...`;
    },
    process: async (args: unknown) => {
      const { name } = args as { name: string };
      const result = await createTodoList(name);

      if (result.success && result.todoList) {
        return {
          content: '',
          systemMessage: `Successfully created todo list: "${name}" with ID: ${result.todoList.id}`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Failed to create todo list: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
  },
  {
    name: 'rename_todo_list',
    getThinkingText: (args: unknown) => {
      const { list_id, name } = args as { list_id?: string; name?: string };

      if (!list_id) {
        return 'Error: No list_id provided for renaming todo list';
      }

      if (!name) {
        return `Error: No new name provided for todo list ${list_id}`;
      }

      return `Renaming todo list ${list_id} to: ${name}...`;
    },
    process: async (args: unknown) => {
      const { list_id, name } = args as { list_id?: string; name?: string };

      if (!list_id) {
        return {
          content: '',
          systemMessage:
            'Error: You must provide a list_id to rename a todo list. Use the list_todo_lists tool to get a valid list ID first.',
          requiresReentry: true,
        };
      }

      if (!name || name.trim() === '') {
        return {
          content: '',
          systemMessage: 'Error: You must provide a non-empty name for the todo list.',
          requiresReentry: true,
        };
      }

      const result = await renameTodoList(list_id, name);

      if (result.success && result.todoList) {
        return {
          content: '',
          systemMessage: `Successfully renamed todo list to: "${name}" (list ID: ${list_id})`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Failed to rename todo list: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
  },
  {
    name: 'delete_todo_list',
    getThinkingText: (args: unknown) => {
      const { list_id } = args as { list_id?: string };

      if (!list_id) {
        return 'Error: No list_id provided for deleting todo list';
      }

      return `Deleting todo list: ${list_id}...`;
    },
    process: async (args: unknown) => {
      const { list_id } = args as { list_id?: string };

      if (!list_id) {
        return {
          content: '',
          systemMessage:
            'Error: You must provide a list_id to delete a todo list. Use the list_todo_lists tool to get a valid list ID first.',
          requiresReentry: true,
        };
      }

      const result = await deleteTodoList(list_id);

      if (result.success) {
        return {
          content: '',
          systemMessage: `Successfully deleted todo list with ID: ${list_id} and all its items`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Failed to delete todo list: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
  },
  {
    name: 'create_todo_item',
    getThinkingText: (args: unknown) => {
      const { list_id, task } = args as { list_id?: string; task?: string };

      // Validate parameters in the thinking text display
      if (!list_id) {
        return 'Error: No list_id provided for creating a todo item';
      }

      if (!task) {
        return `Creating new item in list ${list_id} (no task text provided)`;
      }

      return `Creating new todo item in list ${list_id}: ${task}...`;
    },
    process: async (args: unknown) => {
      const { list_id, task } = args as { list_id?: string; task?: string };

      // Input validation
      if (!list_id) {
        return {
          content: '',
          systemMessage:
            'Error: You must provide a list_id to create a todo item. Use the list_todo_lists tool to get a valid list ID first.',
          requiresReentry: true,
        };
      }

      if (!task || task.trim() === '') {
        return {
          content: '',
          systemMessage: 'Error: You must provide a non-empty task description for the todo item.',
          requiresReentry: true,
        };
      }

      const result = await createTodoItem(list_id, task);

      if (result.success && result.todoItem) {
        return {
          content: '',
          systemMessage: `Successfully created todo item: "${task}" with ID: ${result.todoItem.id} in list with ID: ${list_id}`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Failed to create todo item: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
  },
  {
    name: 'update_todo_item',
    getThinkingText: (args: unknown) => {
      const { item_id } = args as { item_id?: string; task?: string; done?: boolean };

      if (!item_id) {
        return 'Error: No item_id provided for updating todo item';
      }

      return `Updating todo item: ${item_id}...`;
    },
    process: async (args: unknown) => {
      const { item_id, task, done } = args as { item_id?: string; task?: string; done?: boolean };

      if (!item_id) {
        return {
          content: '',
          systemMessage:
            'Error: You must provide an item_id to update a todo item. Use the get_todo_items tool to get valid item IDs first.',
          requiresReentry: true,
        };
      }

      if (task === undefined && done === undefined) {
        return {
          content: '',
          systemMessage: 'Error: You must provide at least one field to update (task or done).',
          requiresReentry: true,
        };
      }

      const updates = {
        task: task !== undefined ? task : undefined,
        done: done !== undefined ? done : undefined,
      };

      const result = await updateTodoItem(item_id, updates);

      if (result.success && result.todoItem) {
        const updatedFields = [];
        if (task !== undefined) updatedFields.push(`task to "${task}"`);
        if (done !== undefined) updatedFields.push(`status to "${done ? 'done' : 'not done'}"`);

        return {
          content: '',
          systemMessage: `Successfully updated todo item ${item_id}: ${updatedFields.join(', ')}`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Failed to update todo item: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
  },
  {
    name: 'delete_todo_item',
    getThinkingText: (args: unknown) => {
      const { item_id } = args as { item_id?: string };

      if (!item_id) {
        return 'Error: No item_id provided for deleting todo item';
      }

      return `Deleting todo item: ${item_id}...`;
    },
    process: async (args: unknown) => {
      const { item_id } = args as { item_id?: string };

      if (!item_id) {
        return {
          content: '',
          systemMessage:
            'Error: You must provide an item_id to delete a todo item. Use the get_todo_items tool to get valid item IDs first.',
          requiresReentry: true,
        };
      }

      const result = await deleteTodoItem(item_id);

      if (result.success) {
        return {
          content: '',
          systemMessage: `Successfully deleted todo item with ID: ${item_id}`,
          requiresReentry: true,
        };
      } else {
        return {
          content: '',
          systemMessage: `Failed to delete todo item: ${result.error}`,
          requiresReentry: true,
        };
      }
    },
  },
];
