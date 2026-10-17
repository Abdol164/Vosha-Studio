import '../src/env.js';
import {writeCopy} from '../src/copywriter.js';

const cases = [
	{
		label: 'AF1 — Pidgin',
		input: {
			productName: "Nike Air Force 1 '07",
			price: '₦45,000',
			points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
			language: 'pcg' as const,
		},
	},
	{
		label: 'AF1 — English',
		input: {
			productName: "Nike Air Force 1 '07",
			price: '₦45,000',
			points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
			language: 'en' as const,
		},
	},
	{
		label: 'AF1 — Yoruba',
		input: {
			productName: "Nike Air Force 1 '07",
			price: '₦45,000',
			points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
			language: 'yo' as const,
		},
	},
	{
		label: 'Jollof party packs — Pidgin',
		input: {
			productName: 'Jollof party packs',
			price: '₦3,500',
			points: ['Feeds 2-3 people', 'Ready in 30 minutes', 'Pickup only in Minna'],
			language: 'pcg' as const,
			cta: 'Order now',
		},
	},
];

for (const {label, input} of cases) {
	console.log(`\n=== ${label} ===`);
	console.log('input:', JSON.stringify(input));
	const copy = await writeCopy(input);
	console.log('output:', JSON.stringify(copy, null, 2));
	console.log(
		`lengths: hook=${copy.hook.length} lines=${copy.lines.map((l) => l.length).join(',')} cta=${copy.cta.length} caption=${copy.caption.length}`,
	);
}
