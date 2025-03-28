import OpenAI from 'openai';
import { db } from '../../db.js';
import { ChatCompletionTool } from 'openai/resources/chat/completions';

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

// Helper function to create a concise chat name using OpenAI
export async function generateChatName(message: string) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
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

// Chat name generator tool
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
