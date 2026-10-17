import type {DropRecord} from './store.js';

// Every value on these pages comes from the caller (product name, points) or the LLM
// (caption), so all of it goes through escapeHtml.
export function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

const STYLE = `
	:root { color-scheme: dark; }
	* { box-sizing: border-box; }
	body { margin: 0; background: #0a0a0a; color: #fff; font: 16px/1.5 system-ui, sans-serif; }
	main { max-width: 480px; margin: 0 auto; padding: 24px 16px 48px; }
	h1 { font-size: 22px; margin: 0 0 4px; }
	.price { color: #E60023; font-weight: 800; font-size: 20px; margin: 0 0 16px; }
	video { width: 100%; aspect-ratio: 9 / 16; background: #000; border: 2px solid #fff; display: block; }
	.caption { white-space: pre-wrap; background: #161616; border: 1px solid #333; padding: 12px; margin: 16px 0 12px; }
	.actions { display: flex; gap: 8px; flex-wrap: wrap; }
	a.btn, button { flex: 1; min-width: 140px; text-align: center; padding: 12px 16px; font: inherit; font-weight: 700;
		background: #fff; color: #0a0a0a; border: 0; cursor: pointer; text-decoration: none; }
	button.secondary { background: #E60023; color: #fff; }
	.muted { color: #999; }
	code { background: #161616; padding: 2px 6px; }
`;

function layout(title: string, body: string, head = ''): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${head}
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function dropPage(drop: DropRecord, mediaUrl: (file: string) => string): string {
	const title = `${drop.props.productName} — Vosha Studio`;
	const heading = `<h1>${escapeHtml(drop.props.productName)}</h1><p class="price">${escapeHtml(drop.props.price)}</p>`;

	if (drop.status === 'rendering') {
		return layout(
			title,
			`${heading}<p>Your video is rendering. This page refreshes on its own.</p>`,
			'<meta http-equiv="refresh" content="5">',
		);
	}
	if (drop.status === 'failed' || !drop.video) {
		return layout(title, `${heading}<p>This video failed to render.</p>`);
	}

	const caption = [drop.copy.caption, drop.copy.hashtags.join(' ')].filter(Boolean).join('\n\n');
	const video = escapeHtml(mediaUrl(drop.video));
	const poster = drop.poster ? ` poster="${escapeHtml(mediaUrl(drop.poster))}"` : '';
	return layout(
		title,
		`${heading}
<video src="${video}"${poster} controls playsinline preload="metadata"></video>
<div class="caption" id="caption">${escapeHtml(caption)}</div>
<div class="actions">
	<button type="button" class="secondary" id="copy">Copy caption</button>
	<a class="btn" href="${video}" download="${escapeHtml(drop.id)}.mp4">Download video</a>
</div>
<script>
	document.getElementById('copy').addEventListener('click', async (e) => {
		await navigator.clipboard.writeText(document.getElementById('caption').textContent);
		e.target.textContent = 'Copied';
	});
</script>`,
	);
}

export function homePage(): string {
	return layout(
		'Vosha Studio',
		`<h1>Vosha Studio</h1>
<p>Product photo + price + 3 selling points → a 10-second vertical promo video with a ready-to-post caption.</p>
<p class="muted">Agents pay $0.25 USDC on Base via x402: <code>POST /drop</code>. Templates: <code>GET /templates</code>.</p>`,
	);
}

export function notFoundPage(): string {
	return layout('Not found — Vosha Studio', '<h1>Not found</h1><p class="muted">No drop with that id.</p>');
}
