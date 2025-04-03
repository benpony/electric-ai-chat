import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { rowToChatMessage } from '../utils.js';
import { generateChatName } from './tools/basic.js';
import { limitContextSize } from './context.js';
import { processAIStream } from './stream.js';

export { generateChatName };
export const ENABLE_AI = true;

export interface CreateAIResponseParams {
  chatId: string;
  contextRows: any[];
  dbUrl?: { redactedUrl: string; redactedId: string; password: string };
}

export async function createAIResponse({ chatId, contextRows, dbUrl }: CreateAIResponseParams) {
  try {
    // Convert rows to ChatMessage objects and limit context size
    const context = contextRows.map(rowToChatMessage);
    const limitedContext = limitContextSize(context);

    // Create a pending AI message
    const messageId = randomUUID();

    // Insert pending message
    await db`
      INSERT INTO messages (id, chat_id, content, user_name, role, status, created_at, updated_at)
      VALUES (${messageId}, ${chatId}, '', 'AI Assistant', 'agent', 'pending', NOW(), NOW())
    `;

    // Start streaming in background
    processAIStream({
      chatId,
      messageId,
      context: limitedContext,
      dbUrlParam: dbUrl,
    }).catch(error => {
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
