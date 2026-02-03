# TODO

## Security

- [ ] **Remove debug token logging** - In `packages/server/src/api/client.ts`, remove the full token logging added for diagnosis:
  ```typescript
  // TEMPORARY: Full token for debugging - REMOVE AFTER DIAGNOSIS
  console.log(`[api] Full token: ${accessToken}`);
  ```
  This was added to help diagnose the prod OAuth 401 issue. Revert to truncated logging after diagnosis is complete.
