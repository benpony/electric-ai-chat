import { db } from '../db.js';
import { ToolCall } from '../types.js';

export interface StreamChunkResult {
  fullContent: string;
  tokenNumber: number;
  tokenBuffer: string;
  lastInsertTime: number;
}

// Helper function to process stream chunks
export async function processStreamChunks(
  stream: AsyncIterable<any>,
  messageId: string,
  tokenNumber: number,
  tokenBuffer: string,
  lastInsertTime: number
): Promise<StreamChunkResult> {
  let fullContent = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
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
  return { fullContent, tokenNumber, tokenBuffer, lastInsertTime };
}
