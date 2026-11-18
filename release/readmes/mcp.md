# CCE MCP — experimental alpha

Read-only, workspace-scoped retrieval through MCP. Requires Node >=22.19.0, Git and ripgrep. No Pi, LM Studio or model download is required. Compiled ESM, types and the `cce-mcp` executable are included.

`cce-mcp --root . --log ./cce-tools.log.jsonl`

Keep tool logs private. Retrieved code is untrusted data. MCP retrieval does not implement lifecycle/compaction or cross-agent state transfer. See bundled QUICKSTART.md and source release documentation.

Apache-2.0; third-party MIT notices retained.
