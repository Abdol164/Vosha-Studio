import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stripInlineComment} from '../src/env.js';

test('stripInlineComment removes a pasted .env comment', () => {
	assert.equal(stripInlineComment('base-sepolia            # base-sepolia | base'), 'base-sepolia');
	assert.equal(stripInlineComment('https://facilitator.payai.network   # supports both'), 'https://facilitator.payai.network');
	assert.equal(stripInlineComment('              # local testing only'), '');
	assert.equal(stripInlineComment('0.25'), '0.25');
	assert.equal(stripInlineComment('abc#def'), 'abc#def');
});
