// First: loads .env before any module reads process.env (queue.ts does at import).
import './env.js';
import {createApp} from './app.js';
import {writeCopy} from './copywriter.js';
import {fetchPhoto} from './image.js';
import {pickRandomTrack} from './music.js';
import {renderQueue} from './queue.js';
import {createRenderer} from './render.js';
import {ensureDataDirs} from './store.js';
import {generateVoiceover} from './voiceover.js';
import {NETWORKS, createPaidMiddleware, x402ConfigFromEnv} from './x402.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const internalBaseUrl = `http://127.0.0.1:${port}`;
const publicBaseUrl = process.env.PUBLIC_BASE_URL || internalBaseUrl;
// Before the slow steps, so a bad payment config fails in a second, not after a bundle.
const x402 = x402ConfigFromEnv(process.env, publicBaseUrl);

await ensureDataDirs();
console.log('Ensuring Chrome Headless Shell + bundling Remotion project...');
// Bundle before listening so the first paid request never waits on (or fails in) the bundle.
const render = await createRenderer();

const app = createApp({
	fetchPhoto,
	writeCopy,
	generateVoiceover,
	pickTrack: pickRandomTrack,
	render,
	queue: renderQueue,
	publicBaseUrl,
	internalBaseUrl,
	paid: [createPaidMiddleware(x402)],
});
app.listen(port, () => {
	console.log(`Vosha Studio listening on :${port} (public ${publicBaseUrl})`);
	console.log(
		`x402: ${x402.amount} atomic USDC on ${NETWORKS[x402.network].network} to ${x402.payTo} via ${x402.facilitatorUrl}`,
	);
});
