export const toolGap = 8;

const overlaps = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height;

export function findToolPosition(preferred, minimum, occupied, bounds) {
  const blocked = occupied.map(({x,y,width,height}) => ({
    x:x-toolGap,y:y-toolGap,width:width+2*toolGap,height:height+2*toolGap,
  }));
  const xs = [0, bounds.width, preferred.x, ...blocked.flatMap(rect => [rect.x, rect.x + rect.width])]
    .filter(x => x >= 0 && x <= bounds.width).sort((a,b) => a-b);
  const ys = [0, bounds.height, preferred.y, ...blocked.flatMap(rect => [rect.y, rect.y + rect.height])]
    .filter(y => y >= 0 && y <= bounds.height).sort((a,b) => a-b);
  let best = null;
  let bestScore = Infinity;

  // Include the drop point so a panel can shrink without moving away from it.
  for (const left of xs) {
    for (const right of xs) {
      const width = Math.min(right-left,preferred.width);
      if (width < minimum.width) continue;
      for (const top of ys) {
        for (const bottom of ys) {
          const height = Math.min(bottom-top,preferred.height);
          if (height < minimum.height || blocked.some(rect => overlaps(rect,{
            x:left,y:top,width:right-left,height:bottom-top,
          }))) continue;
          const x = Math.max(left,Math.min(right-width,preferred.x));
          const y = Math.max(top,Math.min(bottom-height,preferred.y));
          const distance = Math.hypot(x-preferred.x,y-preferred.y);
          const shrink = preferred.width-width + preferred.height-height;
          const score = distance + shrink/2;
          if (score < bestScore) {
            best = {x,y,width,height};
            bestScore = score;
            if (!score) return best;
          }
        }
      }
    }
  }
  return best;
}
