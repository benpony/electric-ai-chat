// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: `electric-ai-chat`,
      removal: input?.stage.toLocaleLowerCase() === `production` ? `retain` : `remove`,
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.66.2`,
          profile: process.env.CI ? undefined : `marketing`,
        },
        neon: `0.6.3`,
        command: `1.0.1`,
      },
    };
  },
  async run() {
    const isProduction = $app.stage.toLocaleLowerCase() === `production`;
    const dbName = isProduction ? `ai-chat` : `ai-chat-${$app.stage}`;
    const region = `us-east-1`;
    const clearAllFile = `./db/clear-all.sql`;
    const schemaFile = `./db/schema.sql`;
    const neonProjectId = new sst.Secret(`NeonProjectId`);
    const subdomain = `examples.${isProduction ? `electric-sql.com` : `electric-sql.dev`}`;

    // Iniitalize a database
    let dbUrl: $util.Input<string>;
    let pooledDbUrl: $util.Input<string>;
    let roleName: $util.Input<string>;
    if ($dev) {
      new sst.x.DevCommand(`AiChatPostgres`, {
        dev: {
          title: `Postgres`,
          command: `docker-compose -f ./.support/docker-compose.yml up`,
          autostart: true,
        },
      });
      dbUrl = `postgresql://postgres:password@localhost:54321/ai-chat`;
      pooledDbUrl = dbUrl;
      roleName = `postgres`;
    } else {
      const neonProject = neon.getProjectOutput({ id: neonProjectId.value });
      const neonDb = createNeonDb({
        projectId: neonProject.id,
        branchId: neonProject.defaultBranchId,
        dbName,
      });
      const dbConfig = {
        project: neonProject,
        databaseName: neonDb.dbName,
        roleName: neonDb.ownerName,
      };
      dbUrl = getNeonConnectionString({ ...dbConfig, pooled: false });
      pooledDbUrl = getNeonConnectionString({ ...dbConfig, pooled: true });
      roleName = neonDb.ownerName;
    }

    dbUrl = $resolve([dbUrl, roleName]).apply(async ([dbUrl, roleName]) => {
      console.log(`Clearing all database contents`);
      await runSqlFile(dbUrl, clearAllFile, roleName);
      console.log(`Running necessary migrations`);
      await runSqlFile(dbUrl, schemaFile, roleName);
      return dbUrl;
    });

    // Initialize AWS services
    const provider = new aws.Provider(`AiChatProvider`, { region });
    const vpc = new sst.aws.Vpc(`AiChatVpc`, { nat: `ec2` }, { provider });
    const cluster = new sst.aws.Cluster(`AiChatCluster`, { forceUpgrade: `v2`, vpc }, { provider });

    // Electric for syncing
    const syncService = new sst.aws.Service(`AiChatSyncService`, {
      cluster,
      image: {
        context: `electric/packages/sync-service`,
      },
      environment: {
        ELECTRIC_INSECURE: $jsonStringify(true),
        DATABASE_URL: dbUrl,
        ELECTRIC_QUERY_DATABASE_URL: pooledDbUrl,
      },
      dev: {
        directory: `electric/packages/sync-service`,
        command: `iex -S mix`,
        autostart: true,
      },
    });

    const syncServiceUrl = $dev
      ? `http://localhost:3000`
      : $interpolate`http://${syncService.service}:3000`;

    // Backend for proxying and other endpoints
    const openAiKey = new sst.Secret(`OpenAiKey`);
    const backendPort = 3001;
    const backend = new sst.aws.Service(
      `AiChatBackend`,
      {
        cluster,
        image: {
          context: `.`,
          dockerfile: `packages/api/Dockerfile`,
        },
        loadBalancer: {
          ports: [{ listen: '443/https', forward: `${backendPort}/http` }],
          domain: {
            name: `${isProduction ? `ai-chat-api` : `ai-chat-api${$app.stage}`}.${subdomain}`,
            dns: sst.cloudflare.dns(),
          },
        },
        environment: {
          DATABASE_URL: pooledDbUrl,
          ELECTRIC_API_URL: syncServiceUrl,
          OPENAI_MODEL: 'gpt-4o-mini',
          OPENAI_API_KEY: openAiKey.value,
          PORT: $jsonStringify(backendPort),
        },
        dev: {
          directory: `packages/api/`,
          command: `pnpm dev:caddy`,
          url: `https://localhost:${backendPort}`,
          autostart: true,
        },
      },
      {
        dependsOn: [syncService],
      }
    );

    // Frontend for actual chat app
    const frontend = new sst.aws.StaticSite(
      `AiChatFrontend`,
      {
        domain: {
          name: `${isProduction ? `ai-chat` : `ai-chat-${$app.stage}`}.${subdomain}`,
          dns: sst.cloudflare.dns(),
        },
        environment: {
          VITE_API_URL: $dev ? backend.url : `http://localhost:${backendPort}`,
        },
        path: `packages/app`,
        build: {
          command: `pnpm build`,
          output: `dist`,
        },
        dev: {
          title: `Frontend`,
          directory: `packages/app`,
          command: `pnpm dev`,
          url: `http://localhost:5173/`,
        },
      },
      { provider }
    );

    return {
      dbUrl: $dev ? dbUrl : `REDACTED`,
      frontend: frontend.url,
      backend: backend.url,
      syncService: syncServiceUrl,
    };
  },
});

function getNeonConnectionString({
  project,
  roleName,
  databaseName,
  pooled,
}: {
  project: $util.Output<neon.GetProjectResult>;
  roleName: $util.Input<string>;
  databaseName: $util.Input<string>;
  pooled: boolean;
}): $util.Output<string> {
  const passwordOutput = neon.getBranchRolePasswordOutput({
    projectId: project.id,
    branchId: project.defaultBranchId,
    roleName: roleName,
  });

  const endpoint = neon.getBranchEndpointsOutput({
    projectId: project.id,
    branchId: project.defaultBranchId,
  });
  const databaseHost = pooled
    ? endpoint.endpoints?.apply(endpoints =>
        endpoints![0].host.replace(endpoints![0].id, endpoints![0].id + `-pooler`)
      )
    : project.databaseHost;
  return $interpolate`postgresql://${passwordOutput.roleName}:${passwordOutput.password}@${databaseHost}/${databaseName}?sslmode=require`;
}

/**
 * Uses the [Neon API](https://neon.tech/docs/manage/databases) along with
 * a Pulumi Command resource and `curl` to create and delete Neon databases.
 */
function createNeonDb({
  projectId,
  branchId,
  dbName,
}: {
  projectId: $util.Input<string>;
  branchId: $util.Input<string>;
  dbName: $util.Input<string>;
}): $util.Output<{
  dbName: string;
  ownerName: string;
}> {
  if (!process.env.NEON_API_KEY) {
    throw new Error(`NEON_API_KEY is not set`);
  }

  const ownerName = `neondb_owner`;

  const createCommand = `curl -f -s "https://console.neon.tech/api/v2/projects/$PROJECT_ID/branches/$BRANCH_ID/databases" \
    -H 'Accept: application/json' \
    -H "Authorization: Bearer $NEON_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
      "database": {
        "name": "'$DATABASE_NAME'",
        "owner_name": "${ownerName}"
      }
    }' \
    && echo " SUCCESS" || echo " FAILURE"`;

  const updateCommand = `echo "Cannot update Neon database with this provisioning method SUCCESS"`;

  const deleteCommand = `curl -f -s -X 'DELETE' \
    "https://console.neon.tech/api/v2/projects/$PROJECT_ID/branches/$BRANCH_ID/databases/$DATABASE_NAME" \
    -H 'Accept: application/json' \
    -H "Authorization: Bearer $NEON_API_KEY" \
    && echo " SUCCESS" || echo " FAILURE"`;

  const result = new command.local.Command(`neon-db-command:${dbName}`, {
    create: createCommand,
    update: updateCommand,
    delete: deleteCommand,
    environment: {
      NEON_API_KEY: process.env.NEON_API_KEY,
      PROJECT_ID: projectId,
      BRANCH_ID: branchId,
      DATABASE_NAME: dbName,
    },
  });
  return $resolve([result.stdout, dbName]).apply(([stdout, dbName]) => {
    if (stdout.endsWith(`SUCCESS`)) {
      console.log(`Created Neon database ${dbName}`);
      return {
        dbName,
        ownerName,
      };
    } else {
      throw new Error(`Failed to create Neon database ${dbName}: ${stdout}`);
    }
  });
}

async function runSqlFile(connectionString: string, filePath: string, roleName?: string) {
  const { Client } = await import('pg');
  const { readFileSync } = await import('fs');

  const client = new Client({ connectionString });

  try {
    await client.connect();
    let sql = readFileSync(filePath, 'utf8');
    // TODO(stefanos): hacky but it'll do to fix neon
    if (roleName && filePath.endsWith(`clear-all.sql`)) {
      console.log(`Replacing 'postgres' role with '${roleName}'`);
      sql = sql.replace(/postgres/g, roleName);
    }
    await client.query(sql);
  } finally {
    await client.end();
  }
}
