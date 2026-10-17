import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { atomicAmount, proposeX402, x402OutputSchema } from "./paybox.js";

const PROTOCOL_VERSION = "2026-07-28";

// TODO: replace with the real deployed domain once the server (Linear MON-42) is live,
// and add this hostname to the plugin's configured network hosts in the portal.
const DROP_ENDPOINT = "https://drop.CHANGE-ME.sslip.io/drop";
const PRICE_USDC = "0.25";

const dropInputSchema = z
	.object({
		product_name: z.string().min(1).max(60),
		price: z.string().min(1).max(24),
		photo_url: z.url(),
		points: z.array(z.string().min(1).max(80)).min(1).max(3),
		language: z.enum(["en", "pcg", "yo"]).optional(),
		template: z.enum(["brutal", "market"]).optional(),
		handle: z.string().max(40).optional(),
		cta: z.string().max(24).optional(),
	})
	.strict();

function createServer() {
	const server = new McpServer(
		{ name: "vosha-studio", version: "0.1.0" },
		{ supportedProtocolVersions: [PROTOCOL_VERSION] },
	);

	server.registerTool(
		"generate_status_drop",
		{
			title: "Generate a status drop video",
			description:
				"Proposes an x402 payment (0.25 USDC on Base) to Vosha Studio, which turns a product photo, " +
				"price, and up to 3 selling points into a 10-second vertical promo video (MP4) with an " +
				"AI-written caption in English, Nigerian Pidgin, or Yoruba. PayBox pays and fetches the " +
				"result after approval; poll the request for the video/poster/page URLs.",
			inputSchema: dropInputSchema,
			outputSchema: x402OutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async (input) =>
			proposeX402({
				chain: "eip155:8453",
				url: DROP_ENDPOINT,
				method: "POST",
				body: input,
				maxAmount: atomicAmount(PRICE_USDC, 6),
			}),
	);

	return server;
}

serveStdio(createServer, { legacy: "reject" });
