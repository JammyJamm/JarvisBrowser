import { PlaywrightMCPClient } from "./mcp-client.js";

async function main() {
  const mcp = new PlaywrightMCPClient("http://localhost:8931/mcp");

  await mcp.connect();

  console.log("Connected!");

  const tools = await mcp.listTools();

  console.log(JSON.stringify(tools, null, 2));

  // Don't disconnect until after printing
  await mcp.disconnect();
}

main().catch(console.error);
