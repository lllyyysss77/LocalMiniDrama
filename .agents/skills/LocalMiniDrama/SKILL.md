```markdown
# LocalMiniDrama Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill provides guidance on contributing to the LocalMiniDrama JavaScript codebase. It covers established coding conventions, synchronization workflows between backend and frontend timeout settings, and best practices for writing and organizing tests. The repository does not use a major framework and follows a modular, convention-driven structure.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `videoClient.js`, `videoGeneration.js`

### Imports
- Use **relative import paths**.
  - Example:
    ```javascript
    import { getTimeout } from './videoGeneration';
    ```

### Exports
- Use **named exports** (not default).
  - Example:
    ```javascript
    // videoGeneration.js
    export function getTimeout() { ... }
    export const DEFAULT_TIMEOUT = 3000;
    ```

### Commit Messages
- Freeform style, no strict prefixes.
- Average length: ~17 characters.

## Workflows

### Synchronize Timeout Settings Backend and Frontend
**Trigger:** When you need to ensure timeout configurations are aligned across backend and frontend.
**Command:** `/sync-timeout`

1. **Update backend configuration files** related to timeout:
    - `backend-node/configs/config.yaml`
    - `backend-node/src/config/videoGeneration.js`
2. **Modify backend service or route files** that use timeout:
    - `backend-node/src/services/videoClient.js`
    - `backend-node/src/routes/settings.js`
    - `backend-node/src/services/videoService.js`
3. **Update corresponding frontend view files** to match backend timeout logic:
    - `frontweb/src/views/FilmCreate.vue`
    - `frontweb/src/views/FreeCreate.vue`

#### Example: Synchronizing Timeout Value

**In `backend-node/src/config/videoGeneration.js`:**
```javascript
export const VIDEO_TIMEOUT = 30000;
```

**In `backend-node/src/services/videoClient.js`:**
```javascript
import { VIDEO_TIMEOUT } from '../config/videoGeneration';

function generateVideo() {
  setTimeout(doSomething, VIDEO_TIMEOUT);
}
```

**In `frontweb/src/views/FilmCreate.vue`:**
```javascript
<script>
export const VIDEO_TIMEOUT = 30000;

export default {
  methods: {
    startGeneration() {
      setTimeout(this.handleTimeout, VIDEO_TIMEOUT);
    }
  }
}
</script>
```

**Tip:** Always keep the timeout value consistent across both backend and frontend files to avoid mismatches.

## Testing Patterns

- **Test files** use the pattern: `*.test.*`
  - Example: `videoClient.test.js`
- **Testing framework** is not specified; check existing test files for conventions.
- Place tests alongside source files or in a dedicated test directory, following the same camelCase naming.

## Commands

| Command        | Purpose                                                        |
|----------------|----------------------------------------------------------------|
| /sync-timeout  | Synchronize timeout settings between backend and frontend code. |
```
