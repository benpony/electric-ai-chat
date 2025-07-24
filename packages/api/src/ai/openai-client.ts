import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

// Configure dotenv before creating the OpenAI client
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../../../.env');
config({ path: envPath });

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
