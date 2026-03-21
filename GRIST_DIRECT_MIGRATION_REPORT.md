# Grist Direct Migration Report

## What Changed

- Added direct Grist SQL support to `src/index.js`
- The MCP now prefers `POST /api/docs/{docId}/sql` against Grist
- The old relay path remains as a fallback for now
- Removed repo-local `n8n/` workflow exports
- Removed n8n-specific wording from docs

## New Preferred Runtime Env

- `GRIST_API_BASE_URL`
- `GRIST_DOC_ID`
- `GRIST_API_KEY` if the document is private
- `GRIST_SQL_TIMEOUT_MS` optional

Legacy fallback still supported:

- `GRIST_RELAY_URL`
- `GRIST_RELAY_API_KEY`

## What Needs To Be Done Outside This Repo

1. Update `fds-products-mcp.env`
   Add:
   - `GRIST_API_BASE_URL=http://grist:8484`
   - `GRIST_DOC_ID=<your grist document id>`
   - `GRIST_API_KEY=<api key>` if required by your Grist setup
   Optional:
   - `GRIST_SQL_TIMEOUT_MS=1000`

2. Restart the `fds-products-mcp` container
   This is required for the new env vars to take effect.

3. Verify direct Grist access works
   Expected result:
   - MCP startup log should say it is running via `grist .../api/docs/<docId>/sql`
   - It should no longer say it is running via relay

4. After verification, remove legacy relay env vars from `fds-products-mcp.env`
   Remove:
   - `N8N_GRIST_RELAY_URL`
   - `N8N_GRIST_RELAY_API_KEY`

5. After the MCP has been stable on direct Grist, you can retire the relay implementation
   This can include:
   - deleting relay secrets
   - removing any relay service/workflow still kept for compatibility
   - later removing relay fallback code from this repo

## Notes

- No docker-compose wiring change appears necessary for `fds-products-mcp`
- The `fds-products-mcp` and `grist` containers already share `internal_net`
- `http://grist:8484` is the correct default from the current compose layout

## Current Unknown You Must Supply

- The Grist document ID for the catalog document
- Whether your Grist instance requires an API key for this MCP path
