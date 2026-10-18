import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { atomicAmount, proposeX402, x402OutputSchema } from "./paybox.js";

const PROTOCOL_VERSION = "2026-07-28";

// Live since MON-42 (Brimble deploy). Add this hostname to the plugin's configured
// network hosts in the portal before uploading.
const DROP_ENDPOINT = "https://vosha-studio.brimble.app/drop";
const PRICE_USDC = "0.25";

const dropInputSchema = z
	.object({
		product_name: z.string().min(1).max(60).describe("Product name as it should appear on screen, max 60 characters."),
		price: z.string().min(1).max(24).describe('Price exactly as the seller writes it, e.g. "₦45,000".'),
		// https only: the server refuses anything else with a 400, which PayBox can't
		// turn into a payment, so the proposal would fail before approval.
		photo_url: z
			.url({ protocol: /^https$/ })
			.describe("Public https:// URL of the product photo (JPEG, PNG or WebP, max 8 MB). Uploaded chat images have no URL; ask the user for a link."),
		points: z.array(z.string().min(1).max(80)).min(1).max(3).describe("1 to 3 selling points, max 80 characters each."),
		language: z.enum(["en", "pcg", "yo"]).optional().describe("Copy language: en (English), pcg (Nigerian Pidgin, default), yo (Yoruba)."),
		template: z.enum(["brutal", "market"]).optional().describe("Visual style, default brutal."),
		handle: z.string().max(40).optional().describe("Seller's social handle, e.g. @shoebaby_minna."),
		cta: z.string().max(24).optional().describe('Call to action, e.g. "DM to order".'),
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
				"AI-written caption in English, Nigerian Pidgin, or Yoruba. Once PayBox approves and pays, " +
				"the call returns immediately with an id and page_url -- the video is still generating at " +
				"that point (usually ready within a minute, occasionally longer). Fetch page_url afterward " +
				"(send Accept: application/json for a machine-readable {status, video_url, poster_url, " +
				"caption, hashtags}; status is \"rendering\", \"done\", or \"failed\") to get the result.",
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
