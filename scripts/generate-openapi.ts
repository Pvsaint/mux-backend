/**
 * scripts/generate-openapi.ts
 *
 * #969 — OpenAPI security schemes
 *
 * Generates a static openapi.json / openapi.yaml artefact from the live NestJS
 * application. The output file is committed to the repo (or published to a
 * registry) so that external consumers (SDKs, API gateways, Postman, Redoc)
 * can import a stable, version-controlled spec without spinning up the server.
 *
 * Usage:
 *   pnpm ts-node scripts/generate-openapi.ts [--format json|yaml] [--out <path>]
 *
 * Defaults:
 *   --format  json
 *   --out     openapi.json (repo root)
 *
 * CI usage (add to ci.yml after build):
 *   pnpm openapi:generate
 *   git diff --exit-code openapi.json  # fails CI if spec drifts without a commit
 *
 * Security invariants enforced by the generated document:
 *   - Every non-public endpoint declares `security: [{ ApiKeyAuth: [] }]`.
 *   - Public endpoints (health, ready, auth/authenticate) carry an empty
 *     security array (`security: []`) so tooling does not prompt for a key.
 *   - The BearerAuth scheme uses bearerFormat: ApiKey so downstream clients
 *     know the token format (`mux_live_*` / `mux_test_*`).
 *   - No secrets, private keys, or JWT material appear in the spec.
 */

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
// js-yaml is an optional dep — only loaded at runtime when --format yaml is used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let yaml: any = null;

// ---------------------------------------------------------------------------
// CLI argument parsing (no external dep — keeps the script self-contained)
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]): { format: 'json' | 'yaml'; out: string } {
  let format: 'json' | 'yaml' = 'json';
  let out = resolve(__dirname, '..', 'openapi.json');

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--format' && argv[i + 1]) {
      const f = argv[++i];
      if (f !== 'json' && f !== 'yaml') {
        console.error(`Unknown format "${f}". Use json or yaml.`);
        process.exit(1);
      }
      format = f;
      if (out.endsWith('.json') && format === 'yaml') {
        out = out.replace('.json', '.yaml');
      }
    } else if (argv[i] === '--out' && argv[i + 1]) {
      out = resolve(argv[++i]);
    }
  }

  return { format, out };
}

// ---------------------------------------------------------------------------
// Spec post-processor
// Stamps security requirements on every operation that does not already carry
// an explicit security override.  Public endpoints (tagged "public" or paths
// matching /health, /ready, /auth/authenticate) receive `security: []`.
// ---------------------------------------------------------------------------
function applySecurityRequirements(doc: OpenAPIObject): OpenAPIObject {
  const PUBLIC_PATHS = new Set([
    '/health',
    '/ready',
    '/auth/authenticate',
    '/v1/health',
    '/v1/ready',
    '/v1/auth/authenticate',
  ]);

  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const method of [
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'options',
      'head',
    ] as const) {
      const operation = (pathItem as any)[method];
      if (!operation) continue;

      // Already has an explicit security declaration — leave it alone.
      if ('security' in operation) continue;

      const isPublic =
        PUBLIC_PATHS.has(path) ||
        (operation.tags ?? []).includes('public');

      operation.security = isPublic ? [] : [{ ApiKeyAuth: [] }];
    }
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { format, out } = parseArgs(process.argv);

  // Lazy-import AppModule so the script only loads when invoked directly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../src/app.module');

  const app = await NestFactory.create(AppModule, {
    logger: false, // suppress NestJS boot logs in script output
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Mux Backend API')
    .setDescription(
      'Backend infrastructure for Mux Protocol — invisible wallets, ' +
        'payment orchestration, and Soroban smart contract interaction on Stellar.\n\n' +
        '### Authentication\n\n' +
        'All endpoints except those tagged **public** require a developer API key ' +
        'transmitted as `Authorization: Bearer mux_live_<key>` (live) or ' +
        '`Authorization: Bearer mux_test_<key>` (test).\n\n' +
        '### Payment isolation\n\n' +
        'Payment endpoints are scoped to the authenticated developer. A caller ' +
        'cannot read or mutate payments that belong to a different developer ' +
        '(responses return 404, not 403, to avoid leaking record existence).',
    )
    .setVersion('1.0')
    .setContact('Mux Labs', 'https://github.com/mux-labs/mux-backend', '')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    // ── Security schemes ────────────────────────────────────────────────────
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'ApiKey',
        name: 'Authorization',
        description:
          'Developer API key in the format `mux_live_<32chars>` (production) or ' +
          '`mux_test_<32chars>` (test). Transmitted as `Authorization: Bearer <key>`.\n\n' +
          'Keys are hashed with SHA-256 before storage; they are returned only once ' +
          'at creation time and cannot be recovered thereafter.',
        in: 'header',
      },
      'ApiKeyAuth',
    )
    .addTag('public', 'Unauthenticated endpoints — no API key required')
    .addTag('auth', 'Authentication and user onboarding')
    .addTag('wallets', 'Invisible wallet lifecycle management')
    .addTag('payments', 'Payment orchestration with developer-scoped isolation')
    .addTag('transactions', 'Stellar transaction relay and signing')
    .addTag('api-keys', 'API key management for developers')
    .addTag('limits', 'Spending limit enforcement')
    .addTag('developers', 'Developer account management')
    .addTag('projects', 'Project management under a developer account')
    .addTag('webhooks', 'Outbound webhook delivery and configuration')
    .addTag('key-management', 'Stellar keypair lifecycle and rotation')
    .addTag('recovery', 'Wallet recovery flows')
    .addTag('health', 'Liveness and readiness probes')
    .build();

  let document = SwaggerModule.createDocument(app, swaggerConfig);
  document = applySecurityRequirements(document);

  await app.close();

  let content: string;
  if (format === 'yaml') {
    try {
      // js-yaml is a transitive dep of many NestJS packages — safe to use here.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      yaml = require('js-yaml');
      content = yaml.dump(document, { lineWidth: 120 });
    } catch {
      console.error(
        'js-yaml is not installed. Install it with: pnpm add -D js-yaml @types/js-yaml',
      );
      process.exit(1);
    }
  } else {
    content = JSON.stringify(document, null, 2);
  }

  writeFileSync(out, content, 'utf8');
  console.log(`OpenAPI spec written to: ${out}`);
}

main().catch((err) => {
  console.error('Failed to generate OpenAPI spec:', err);
  process.exit(1);
});
