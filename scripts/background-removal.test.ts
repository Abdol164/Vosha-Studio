import assert from 'node:assert/strict';
import {test} from 'node:test';
import {backgroundRemovalEnabled} from '../src/background-removal.js';

// The actual removeProductBackground() isn't exercised here: it loads a ~40MB ONNX
// model and costs ~1.1GB RSS + ~2.5s on first call (see NOTES.md) — manually verified
// instead of adding that weight to every test run. This covers the cheap, always-safe
// part: the opt-in toggle defaults to off.
test('backgroundRemovalEnabled defaults to false', () => {
	const original = process.env.BACKGROUND_REMOVAL_ENABLED;
	try {
		delete process.env.BACKGROUND_REMOVAL_ENABLED;
		assert.equal(backgroundRemovalEnabled(), false);
		process.env.BACKGROUND_REMOVAL_ENABLED = 'false';
		assert.equal(backgroundRemovalEnabled(), false);
		process.env.BACKGROUND_REMOVAL_ENABLED = 'true';
		assert.equal(backgroundRemovalEnabled(), true);
	} finally {
		if (original === undefined) delete process.env.BACKGROUND_REMOVAL_ENABLED;
		else process.env.BACKGROUND_REMOVAL_ENABLED = original;
	}
});
