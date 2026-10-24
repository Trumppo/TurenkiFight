/** Presentation-only palette and layout. No simulation dependencies. */
export const VISUAL = {
  width: 384,
  height: 216,
  hudHeight: 24,
  colors: {
    sky: 0x6d8999,
    station: 0xc2a27d,
    roof: 0x293f45,
    ground: 0x76786f,
    cream: 0xf4e5b4,
    fighters: [0xcf665c, 0x54b7ae, 0xe3b85e, 0x9e85cc] as const,
  },
} as const;

export function playerColor(playerId: string): number {
  const match = /^P([1-9][0-9]*)$/.exec(playerId);
  const index = match ? Number(match[1]) - 1 : 0;
  return VISUAL.colors.fighters[index % VISUAL.colors.fighters.length];
}
