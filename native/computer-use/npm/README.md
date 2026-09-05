# munim-computer-use

npm launcher for [Computer Use](https://github.com/munimtechnologies/computer-use), the open-source Computer Use MCP server by Munim Technologies. On first run it downloads the signed native binary for your platform from GitHub Releases and starts it over stdio.

```sh
claude mcp add computer-use -- npx -y munim-computer-use
```

macOS (universal) and Windows x64 are prebuilt. On Linux build from source and set `COMPUTER_USE_BINARY` to the result. Full documentation: https://github.com/munimtechnologies/computer-use
