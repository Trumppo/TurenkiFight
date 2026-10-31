import { test, expect } from '@playwright/test';

test('VIS-02B P3/P4 original retro fighters: all poses and distinct silhouettes', async ({ page }) => {
  test.skip(process.env.VITE_VISUAL_STYLE !== 'retro', 'Retro-only character artwork');
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const result = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (name: string) => {
      textures: { get: (key: string) => { getSourceImage: () => HTMLCanvasElement } };
    } } } }).__turenkiGame!;
    const textures = game.scene.getScene('StationScene').textures;
    const poses = ['idle','walk','depth','punch','kick','jump','jumpkick','hit','ko','respawn'];
    const results = ['P3','P4'].flatMap(id => poses.flatMap(pose =>
      Array.from({length:4}, (_,frame) => {
        const image = textures.get(`fighter-${id}-${pose}-${frame}`).getSourceImage();
        const pixels = image.getContext('2d')!.getImageData(0,0,image.width,image.height).data;
        let opaque = 0;
        for (let i=3;i<pixels.length;i+=4) if (pixels[i]) opaque++;
        return {id,pose,frame,width:image.width,height:image.height,opaque};
      })));
    const images = ['P1','P2','P3','P4'].map(id =>
      textures.get(`fighter-${id}-idle-0`).getSourceImage().getContext('2d')!.getImageData(0,0,32,48).data);
    const different = images.map((a,i) => images.slice(i+1).map(b => {
      let count = 0;
      for(let k=0;k<a.length;k+=4) if(a[k]!==b[k]||a[k+1]!==b[k+1]||a[k+2]!==b[k+2]||a[k+3]!==b[k+3]) count++;
      return count;
    })).flat();
    return {results,different};
  });
  expect(result.results).toHaveLength(80);
  for (const pose of result.results) {
    expect([pose.width,pose.height]).toEqual([32,48]);
    expect(pose.opaque).toBeGreaterThan(40);
  }
  expect(result.different).toHaveLength(6);
  for (const count of result.different) expect(count).toBeGreaterThan(100);
});
