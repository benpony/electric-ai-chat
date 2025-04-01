import { ChatMessage } from './types.js';
import { randomUUID } from 'crypto';
import { db } from './db.js';

export const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export function rowToChatMessage(row: any): ChatMessage {
  return {
    id: row.id,
    chat_id: row.chat_id,
    content: row.content,
    user_name: row.user_name,
    created_at: row.created_at,
    role: row.role,
    status: row.status,
  };
}

export type ActionRelationship = {
  type: string;
  id: string;
  name: string;
};

export async function recordAction(
  chatId: string,
  action: string,
  entityId: string,
  entityName: string,
  relationships: ActionRelationship[] = []
) {
  try {
    const actionId = randomUUID();
    await db`
      INSERT INTO ai_actions (id, chat_id, action_type, entity_id, entity_name, metadata)
      VALUES (${actionId}, ${chatId}, ${action}, ${entityId}, ${entityName}, ${JSON.stringify({ relationships })})
    `;
    console.log(`Recorded action: ${action} on ${entityName} (${entityId})`);
    return actionId;
  } catch (error) {
    console.error('Error recording action:', error);
    return null;
  }
}

export async function getRecentActions(chatId: string, limit: number = 10) {
  try {
    const actions = await db`
      SELECT * FROM ai_actions 
      WHERE chat_id = ${chatId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return actions;
  } catch (error) {
    console.error('Error fetching recent actions:', error);
    return [];
  }
}

export async function getMostRecentEntityByType(chatId: string, entityType: string) {
  try {
    const [action] = await db`
      SELECT * FROM ai_actions 
      WHERE chat_id = ${chatId} AND action_type LIKE ${`%${entityType}%`}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return action;
  } catch (error) {
    console.error('Error fetching most recent entity:', error);
    return null;
  }
}

export function formatActionDescription(action: any) {
  const meta = action.metadata || {};
  const relationships = meta.relationships || [];

  switch (action.action_type) {
    case 'create_list':
      return `Created todo list "${action.entity_name}" (${action.entity_id})`;
    case 'create_item':
      const listRel = relationships.find((r: ActionRelationship) => r.type === 'belongs_to_list');
      return `Created todo item "${action.entity_name}" in list "${listRel?.name || 'unknown'}"`;
    case 'update_item':
      return `Updated todo item "${action.entity_name}" (${meta.update_type || 'properties'})`;
    case 'delete_item':
      return `Deleted todo item "${action.entity_name}"`;
    default:
      return `${action.action_type}: "${action.entity_name}" (${action.entity_id})`;
  }
}

// Tool call history tracking system
export type ToolCallSummary = {
  toolName: string;
  args: any;
  result: string;
  timestamp: Date;
  targetEntityId?: string;
  targetEntityName?: string;
  targetEntityType?: string;
};

// Store tool call in the database for tracking
export async function storeToolCall(
  chatId: string,
  toolName: string,
  args: any,
  result: string,
  targetEntityId?: string,
  targetEntityName?: string,
  targetEntityType?: string
): Promise<string> {
  try {
    const callId = randomUUID();
    await db`
      INSERT INTO ai_actions (
        id, chat_id, action_type, entity_id, entity_name, metadata
      ) VALUES (
        ${callId}, 
        ${chatId}, 
        ${'tool_call:' + toolName}, 
        ${targetEntityId || 'none'}, 
        ${targetEntityName || toolName},
        ${JSON.stringify({
          args,
          result: result.substring(0, 500), // Limit size
          entityType: targetEntityType || 'none',
        })}
      )
    `;
    console.log(`Stored tool call: ${toolName}`);
    return callId;
  } catch (error) {
    console.error('Error storing tool call:', error);
    return randomUUID(); // Return a dummy ID to prevent further errors
  }
}

// Get recent tool calls in the current chat
export async function getRecentToolCalls(
  chatId: string,
  limit: number = 5
): Promise<ToolCallSummary[]> {
  try {
    const calls = await db`
      SELECT * FROM ai_actions
      WHERE chat_id = ${chatId} AND action_type LIKE 'tool_call:%'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return calls.map((call: any) => {
      const meta =
        typeof call.metadata === 'string' ? JSON.parse(call.metadata) : call.metadata || {};

      return {
        toolName: call.action_type.replace('tool_call:', ''),
        args: meta.args || {},
        result: meta.result || '',
        timestamp: call.created_at,
        targetEntityId: call.entity_id !== 'none' ? call.entity_id : undefined,
        targetEntityName:
          call.entity_name !== call.action_type.replace('tool_call:', '')
            ? call.entity_name
            : undefined,
        targetEntityType: meta.entityType !== 'none' ? meta.entityType : undefined,
      };
    });
  } catch (error) {
    console.error('Error fetching recent tool calls:', error);
    return [];
  }
}

// Detect potential duplicate tool calls
export async function detectSimilarToolCalls(
  chatId: string,
  currentToolName: string,
  currentArgs: any,
  toolHandler?: any
): Promise<ToolCallSummary | null> {
  try {
    // Get recent calls of the same tool type
    const recentCalls = await db`
      SELECT * FROM ai_actions
      WHERE 
        chat_id = ${chatId} AND 
        action_type = ${'tool_call:' + currentToolName}
      ORDER BY created_at DESC
      LIMIT 3
    `;

    if (recentCalls.length === 0) {
      return null; // No previous calls to this tool
    }

    // Check for similar arguments
    for (const call of recentCalls) {
      const meta =
        typeof call.metadata === 'string' ? JSON.parse(call.metadata) : call.metadata || {};

      const prevArgs = meta.args || {};

      // Determine if calls are similar, passing the tool handler
      const isSimilar = areSimilarToolCalls(currentToolName, currentArgs, prevArgs, toolHandler);

      if (isSimilar) {
        return {
          toolName: currentToolName,
          args: prevArgs,
          result: meta.result || '',
          timestamp: call.created_at,
          targetEntityId: call.entity_id !== 'none' ? call.entity_id : undefined,
          targetEntityName: call.entity_name !== currentToolName ? call.entity_name : undefined,
          targetEntityType: meta.entityType !== 'none' ? meta.entityType : undefined,
        };
      }
    }

    return null; // No similar calls found
  } catch (error) {
    console.error('Error detecting similar tool calls:', error);
    return null;
  }
}

// Determine if two tool calls are similar
function areSimilarToolCalls(
  toolName: string,
  currentArgs: any,
  prevArgs: any,
  toolHandler?: any
): boolean {
  // If the tool has its own similarity check method, use that first
  if (toolHandler && typeof toolHandler.checkIfSimilar === 'function') {
    return toolHandler.checkIfSimilar(currentArgs, prevArgs);
  }

  // Generic fallback for tools without custom similarity checks
  // For any tool, do a basic match on the key arguments
  if (!currentArgs || !prevArgs) return false;

  // Count matching properties
  const keys = Object.keys(currentArgs);
  let matches = 0;
  let exactMatch = false;

  for (const key of keys) {
    if (prevArgs[key] !== undefined) {
      if (typeof currentArgs[key] === 'string' && typeof prevArgs[key] === 'string') {
        // Case-insensitive string comparison
        if (currentArgs[key].toLowerCase() === prevArgs[key].toLowerCase()) {
          matches++;
          // ID fields are usually critical - exact match is significant
          if (key.includes('id') || key.includes('Id') || key === 'name') {
            exactMatch = true;
          }
        }
      } else if (currentArgs[key] === prevArgs[key]) {
        // Exact comparison for non-string values
        matches++;
      }
    }
  }

  // Consider similar if:
  // 1. More than half properties match, or
  // 2. There's at least one match AND it's an ID/name field (critical identifier)
  return (matches > 0 && matches >= keys.length / 2) || (matches > 0 && exactMatch);
}
