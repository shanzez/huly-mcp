---
"@firfi/huly-mcp": patch
---

Fix assignee resolution for workspace members whose email exists only as a SocialIdentity by moving the lookup into the shared person resolver and prioritizing it ahead of Channel-based lookups.
