import { ChatCompletionTool } from 'openai/resources/chat/completions';

export const ELECTRIC_DOCS_URL = 'https://electric-sql.com/llms.txt';

// Cache for ElectricSQL documentation
let electricDocsCache: string | null = null;
let lastFetchTime: number = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Track if a chat has started discussing ElectricSQL
// If the chat has started discussing ElectricSQL, we will continue to provide the full
// llms.txt documentation to the AI as a system message on each prompt.
export const electricChats = new Set<string>();

export async function fetchElectricDocs(): Promise<string> {
  console.log('fetching electric docs');
  const now = Date.now();
  if (electricDocsCache && now - lastFetchTime < CACHE_DURATION) {
    return electricDocsCache;
  }

  try {
    const response = await fetch(ELECTRIC_DOCS_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch ElectricSQL docs: ${response.statusText}`);
    }
    electricDocsCache = await response.text();
    lastFetchTime = now;
    return electricDocsCache;
  } catch (error) {
    console.error('Error fetching ElectricSQL docs:', error);
    return ''; // Return empty string on error
  }
}

// ElectricSQL tools
export const electricTools: ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'fetch_electric_docs',
      description:
        'Fetch the latest ElectricSQL documentation to help answer questions about ElectricSQL features, best practices, and solutions',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The specific query or topic to look up in the documentation',
          },
        },
        required: ['query'],
      },
    },
  },
];
