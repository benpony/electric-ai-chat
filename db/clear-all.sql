BEGIN;
-- Drop all objects in a schema
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Recreate default grants
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- Recreate extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Add other extensions you were using
COMMIT;