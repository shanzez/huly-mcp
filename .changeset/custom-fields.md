---
"@firfi/huly-mcp": minor
---

Add custom fields support with auto-discovery: `list_custom_fields`, `get_custom_field_values`, and `set_custom_field`. The server now discovers field definitions from Huly's Attribute system without manual configuration and supports Cards, Issues, and other classes with custom fields.

Harden typed outputs for the new custom-fields, issue-relations, time, and workspace tool surfaces. These tools now validate and encode their MCP responses through Effect schemas at the boundary so branded internal domain values are converted to stable wire output and invalid result shapes fail fast instead of leaking through the transport layer.
