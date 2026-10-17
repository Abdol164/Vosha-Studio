// Opt-in, off by default: the ONNX model adds real memory/CPU weight per request, and
// the host (Brimble) has already hit an OOM once just from bundling Remotion (see
// NOTES.md). Keeping this behind an env var means it can be disabled instantly if it
// destabilizes the live deploy, without a code rollback.
export function backgroundRemovalEnabled(): boolean {
	return process.env.BACKGROUND_REMOVAL_ENABLED === 'true';
}

// Returns a PNG Buffer with the background removed, or null on any failure — callers
// fall back to the original photo rather than failing the whole drop, same pattern as
// copywriter.ts/voiceover.ts. `model: "small"` (~40MB quantized) over the default
// "medium" (~80MB) to keep the footprint down on a memory-constrained host.
//
// The import is deliberately dynamic, inside the function, not at module scope: this
// package pulls in onnxruntime-node, a native addon. `server.ts` imports this module
// unconditionally (so it can check backgroundRemovalEnabled() at all), and a top-level
// `import` would load that native binary into every process regardless of the toggle —
// if it's ever incompatible with the deploy container, that's a startup-time crash with
// zero recourse. A dynamic import means the toggle actually gates whether this package
// touches the process at all, not just whether its output gets used.
export async function removeProductBackground(
	input: Buffer,
	mimeType: 'image/jpeg' | 'image/png',
): Promise<Buffer | null> {
	try {
		const {removeBackground} = await import('@imgly/background-removal-node');
		// Passing a raw Buffer/Uint8Array makes the library wrap it in `new Blob([data])`
		// with no `type`, which its own internal format-sniffer then can't identify
		// ("Unsupported format: " — empty) and rejects outright. Giving it a Blob with an
		// explicit MIME type ourselves sidesteps that entirely.
		const blob = new Blob([new Uint8Array(input)], {type: mimeType});
		const result = await removeBackground(blob, {
			model: 'small',
			output: {format: 'image/png', quality: 0.8},
		});
		return Buffer.from(await result.arrayBuffer());
	} catch (err) {
		console.warn('background removal skipped', err instanceof Error ? err.message : err);
		return null;
	}
}
