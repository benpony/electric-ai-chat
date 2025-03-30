import { ChatCompletionTool } from 'openai/resources/chat/completions';
import postgres from 'postgres';

interface SchemaInfo {
  tableName: string;
  columns: {
    name: string;
    type: string;
    isNullable: boolean;
    defaultValue: string | null;
  }[];
  primaryKey: string[];
  foreignKeys: {
    column: string;
    references: {
      table: string;
      column: string;
    };
  }[];
}

interface SchemaToolParams {
  redactedUrl: string;
  redactedId: string;
  password: string; // Password is sent with each request
}

/**
 * Get the schema information for a database
 */
export async function getDatabaseSchema(
  redactedUrl: string,
  password: string
): Promise<SchemaInfo[]> {
  console.log('Connecting to database with URL:', redactedUrl);
  console.log('Using password (first 3 chars):', password.substring(0, 3) + '...');

  // Create a URL object to properly handle the replacement
  try {
    const urlObj = new URL(redactedUrl);

    // Extract the username from the auth part
    const authParts = urlObj.username.split(':');
    if (authParts.length > 1) {
      urlObj.username = authParts[0];
      urlObj.password = password;
    } else {
      // If there's no colon in the username, set the password directly
      urlObj.password = password;
    }

    const actualUrl = urlObj.toString();
    console.log('Actual URL (with password hidden):', actualUrl.replace(password, '[HIDDEN]'));

    // Create a read-only connection
    const sql = postgres(actualUrl, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: 'require',
      transform: {
        undefined: null,
      },
      prepare: false,
      max_lifetime: 60 * 30,
    });

    try {
      // Get all tables in the public schema
      const tables = await sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `;

      const schemaInfo: SchemaInfo[] = [];

      for (const { table_name } of tables) {
        // Get column information
        const columns = await sql`
          SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = ${table_name}
          ORDER BY ordinal_position;
        `;

        // Get primary key information
        const primaryKeys = await sql`
          SELECT c.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage AS ccu USING (constraint_schema, constraint_name)
          JOIN information_schema.columns AS c ON c.table_name = tc.table_name AND c.column_name = ccu.column_name
          WHERE tc.table_schema = 'public'
          AND tc.table_name = ${table_name}
          AND tc.constraint_type = 'PRIMARY KEY';
        `;

        // Get foreign key information
        const foreignKeys = await sql`
          SELECT
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = ${table_name};
        `;

        schemaInfo.push({
          tableName: table_name,
          columns: columns.map(col => ({
            name: col.column_name,
            type: col.data_type,
            isNullable: col.is_nullable === 'YES',
            defaultValue: col.column_default,
          })),
          primaryKey: primaryKeys.map(pk => pk.column_name),
          foreignKeys: foreignKeys.map(fk => ({
            column: fk.column_name,
            references: {
              table: fk.foreign_table_name,
              column: fk.foreign_column_name,
            },
          })),
        });
      }

      return schemaInfo;
    } finally {
      await sql.end();
    }
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}

/**
 * Tool definition for the AI to get database schema
 */
export const getSchemaTool: ChatCompletionTool = {
  type: 'function' as const,
  function: {
    name: 'get_database_schema',
    description:
      'Get the schema information for a PostgreSQL database to answer questions about tables, columns, relationships, and structure. Use this tool when the user asks about database structure or needs information about the database schema.',
    parameters: {
      type: 'object',
      properties: {
        redactedUrl: {
          type: 'string',
          description: 'The redacted database URL',
        },
        redactedId: {
          type: 'string',
          description: 'The redacted ID for the database password',
        },
        password: {
          type: 'string',
          description: 'The actual database password',
        },
      },
      required: ['redactedUrl', 'redactedId', 'password'],
    },
  },
};

// Export all PostgreSQL tools as a single array
export const postgresTools = [getSchemaTool]; 