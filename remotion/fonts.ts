import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadJetBrainsMono} from '@remotion/google-fonts/JetBrainsMono';

const inter = loadInter('normal', {weights: ['600', '900']});
const jetBrainsMono = loadJetBrainsMono('normal', {weights: ['400', '700']});

export const interFontFamily = inter.fontFamily;
export const jetBrainsMonoFontFamily = jetBrainsMono.fontFamily;

export const fontsLoaded = Promise.all([
	inter.waitUntilDone(),
	jetBrainsMono.waitUntilDone(),
]);
