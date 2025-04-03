import { ChatMessage } from '../types.js';

export function limitContextSize(messages: ChatMessage[]): ChatMessage[] {
  // Estimate tokens (rough approximation)
  let totalTokens = 0;
  const maxTokens = 20000; // More conservative limit to leave room for response
  const limitedMessages: ChatMessage[] = [];

  // Add messages from most recent to oldest until we hit the token limit
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    // More conservative estimate: 1 token ≈ 3 characters
    const messageTokens = Math.ceil(message.content.length / 3);

    if (totalTokens + messageTokens > maxTokens) {
      break;
    }

    totalTokens += messageTokens;
    limitedMessages.unshift(message);
  }

  return limitedMessages;
}
