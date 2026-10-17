// Shared timeline constants (300 frames / 10s @ 30fps) — spec §8 beat structure.
// Scene components (ProductPointsScene, MarketProductPointsScene) use REVEAL_FRAMES/
// POINT_SLOT as LOCAL offsets relative to their own Sequence. Composers (Brutal.tsx,
// Market.tsx) use all of these as GLOBAL offsets to place voiceover clips so narration
// lands when its matching beat actually appears on screen, instead of one continuous
// clip read from frame 0 that finishes long before the video catches up.
export const HOOK_FRAMES = 36;
export const PRODUCT_POINTS_FRAMES = 189;
export const PRICE_FRAMES = 45;
export const CTA_FRAMES = 30;

// Local to the product+points Sequence.
export const REVEAL_FRAMES = 84;
export const POINT_SLOT = 35;
