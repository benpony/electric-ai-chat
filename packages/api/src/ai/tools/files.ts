import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { db } from '../../db.js';
import { randomUUID } from 'crypto';

// File management tools
export const fileTools: ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'create_file',
      description: 'Create a new file in the chat with the specified content',
      parameters: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'The ID of the chat to create the file in',
          },
          path: {
            type: 'string',
            description: 'The path to the file (e.g. "src/index.ts" or "README.md")',
          },
          mime_type: {
            type: 'string',
            description:
              'The MIME type of the file (e.g. "text/plain", "text/markdown", "image/png")',
          },
          content: {
            type: 'string',
            description: 'The content of the file',
          },
        },
        required: ['chat_id', 'path', 'mime_type', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description: 'Edit an existing file in the chat',
      parameters: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'The ID of the chat containing the file',
          },
          path: {
            type: 'string',
            description: 'The path to the file to edit',
          },
          content: {
            type: 'string',
            description: 'The new content of the file',
          },
        },
        required: ['chat_id', 'path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_file',
      description: 'Delete a file from the chat',
      parameters: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'The ID of the chat containing the file',
          },
          path: {
            type: 'string',
            description: 'The path to the file to delete',
          },
        },
        required: ['chat_id', 'path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'rename_file',
      description: 'Rename a file in the chat',
      parameters: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'The ID of the chat containing the file',
          },
          old_path: {
            type: 'string',
            description: 'The current path of the file',
          },
          new_path: {
            type: 'string',
            description: 'The new path for the file',
          },
        },
        required: ['chat_id', 'old_path', 'new_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the chat',
      parameters: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'The ID of the chat containing the file',
          },
          path: {
            type: 'string',
            description: 'The path to the file to read',
          },
        },
        required: ['chat_id', 'path'],
      },
    },
  },
];

// Helper functions to handle file operations
export async function createFile(chatId: string, path: string, mimeType: string, content: string) {
  try {
    const id = randomUUID();
    await db`
      INSERT INTO files (id, chat_id, path, mime_type, content)
      VALUES (${id}, ${chatId}, ${path}, ${mimeType}, ${content})
    `;
    return { success: true, id };
  } catch (error) {
    console.error('Error creating file:', error);
    return { success: false, error: 'Failed to create file' };
  }
}

export async function editFile(chatId: string, path: string, content: string) {
  try {
    await db`
      UPDATE files
      SET content = ${content}, updated_at = NOW()
      WHERE chat_id = ${chatId} AND path = ${path}
    `;
    return { success: true };
  } catch (error) {
    console.error('Error editing file:', error);
    return { success: false, error: 'Failed to edit file' };
  }
}

export async function deleteFile(chatId: string, path: string) {
  try {
    await db`
      DELETE FROM files
      WHERE chat_id = ${chatId} AND path = ${path}
    `;
    return { success: true };
  } catch (error) {
    console.error('Error deleting file:', error);
    return { success: false, error: 'Failed to delete file' };
  }
}

export async function renameFile(chatId: string, oldPath: string, newPath: string) {
  try {
    await db`
      UPDATE files
      SET path = ${newPath}, updated_at = NOW()
      WHERE chat_id = ${chatId} AND path = ${oldPath}
    `;
    return { success: true };
  } catch (error) {
    console.error('Error renaming file:', error);
    return { success: false, error: 'Failed to rename file' };
  }
}

export async function readFile(chatId: string, path: string) {
  try {
    const [file] = await db`
      SELECT content, mime_type
      FROM files
      WHERE chat_id = ${chatId} AND path = ${path}
    `;
    return { success: true, file };
  } catch (error) {
    console.error('Error reading file:', error);
    return { success: false, error: 'Failed to read file' };
  }
}
