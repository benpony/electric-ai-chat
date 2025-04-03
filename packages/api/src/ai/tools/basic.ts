import OpenAI from 'openai';
import { db } from '../../db.js';
import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { model } from '../../utils.js';
import { ToolHandler } from '../../types.js';

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

export async function generateChatName(message: string) {
  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Create a short, concise human readable name (maximum 50 characters) that summarizes the following message. Return only the name, no quotes or explanation. It will be used in the UI as the chat name.',
        },
        {
          role: 'user',
          content: message,
        },
      ],
      max_tokens: 50,
    });

    // Extract and return the generated name
    const generatedName = completion.choices[0]?.message.content?.trim() || '';
    return generatedName.slice(0, 50); // Ensure name is not too long
  } catch (err) {
    console.error('Error generating chat name:', err);
    return null; // Return null if generation failed
  }
}

export async function renameChat(chatId: string, context: string): Promise<string> {
  try {
    const newName = await generateChatName(context);
    if (newName) {
      await db`
        UPDATE chats
        SET name = ${newName}
        WHERE id = ${chatId}
      `;
      return newName;
    }
    return '';
  } catch (err) {
    console.error('Error renaming chat:', err);
    return '';
  }
}

// Chat rename tool
export async function renameChatTo(chatId: string, name: string): Promise<string> {
  try {
    // Limit name to 50 characters
    const truncatedName = name.slice(0, 50);
    await db`
      UPDATE chats
      SET name = ${truncatedName}
      WHERE id = ${chatId}
    `;
    return truncatedName;
  } catch (err) {
    console.error('Error renaming chat:', err);
    return '';
  }
}

// Pin/Unpin chat tool
export async function pinChat(chatId: string, pinned: boolean): Promise<boolean> {
  try {
    await db`
      UPDATE chats
      SET pinned = ${pinned}
      WHERE id = ${chatId}
    `;
    return true;
  } catch (err) {
    console.error('Error pinning/unpinning chat:', err);
    return false;
  }
}

// Basic chat tools
export const basicTools: ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'rename_chat',
      description: 'Rename the current chat session based on its content',
      parameters: {
        type: 'object',
        properties: {
          context: {
            type: 'string',
            description: 'A summary of the chat context to use for generating the new name',
          },
        },
        required: ['context'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'rename_chat_to',
      description: 'Rename the current chat session to a specific name provided by the user',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The exact name to rename the chat to',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'pin_chat',
      description: 'Pin the current chat to keep it at the top of the sidebar',
      parameters: {
        type: 'object',
        properties: {
          pinned: {
            type: 'boolean',
            description: 'Whether to pin (true) or unpin (false) the chat',
          },
        },
        required: ['pinned'],
      },
    },
  },
];

// Tool handlers
export const basicToolHandlers: ToolHandler[] = [
  {
    name: 'rename_chat',
    getThinkingText: (args: unknown) => 'Renaming chat...',
    process: async (
      args: unknown,
      chatId: string,
      messageId: string,
      abortController: AbortController,
      dbUrlParam?: { redactedUrl: string; redactedId: string; password: string }
    ) => {
      const { context } = args as { context: string };
      const newName = await renameChat(chatId, context);
      return {
        content: newName
          ? `\n\nI've renamed this chat to: "${newName}"`
          : '\n\nFailed to rename chat.',
      };
    },
  },
  {
    name: 'rename_chat_to',
    getThinkingText: (args: unknown) => {
      const { name } = args as { name: string };
      return `Renaming chat to: "${name}"`;
    },
    process: async (
      args: unknown,
      chatId: string,
      messageId: string,
      abortController: AbortController,
      dbUrlParam?: { redactedUrl: string; redactedId: string; password: string }
    ) => {
      const { name } = args as { name: string };
      const newName = await renameChatTo(chatId, name);
      return {
        content: newName
          ? `\n\nI've renamed this chat to: "${newName}"`
          : '\n\nFailed to rename chat.',
      };
    },
  },
  {
    name: 'pin_chat',
    getThinkingText: (args: unknown) => {
      const { pinned } = args as { pinned: boolean };
      return `${pinned ? 'Pinning' : 'Unpinning'} chat...`;
    },
    process: async (
      args: unknown,
      chatId: string,
      messageId: string,
      abortController: AbortController,
      dbUrlParam?: { redactedUrl: string; redactedId: string; password: string }
    ) => {
      const { pinned } = args as { pinned: boolean };
      const success = await pinChat(chatId, pinned);
      return {
        content: success
          ? `\n\nI've ${pinned ? 'pinned' : 'unpinned'} this chat.`
          : '\n\nFailed to update pin status.',
      };
    },
  },
];
