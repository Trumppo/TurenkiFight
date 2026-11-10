/** Stable retro texture API: 32x48 pixels, bottom-centre foot anchor, four frames per pose. */
export type FighterPose = 'idle' | 'walk' | 'depth' | 'punch' | 'kick' | 'jump' | 'jumpkick' | 'hit' | 'ko' | 'respawn';
export const POSES: FighterPose[] = ['idle', 'walk', 'depth', 'punch', 'kick', 'jump', 'jumpkick', 'hit', 'ko', 'respawn'];
export const FRAMES_PER_POSE = 4;
export const fighterKey = (id: string, pose: FighterPose, frame: number): string =>
  `fighter-${id}-${pose}-${frame % FRAMES_PER_POSE}`;
