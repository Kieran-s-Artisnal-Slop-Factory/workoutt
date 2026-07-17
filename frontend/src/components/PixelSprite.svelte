<script lang="ts">
  /**
   * Renders one pet-game pixel grid as crisp SVG rects (pets.md §"Pixel
   * art"). ~576 rects worst case (24×24) — no need to merge runs.
   *
   * `animation`:
   *  - 'idle'  classic two-frame JRPG bob (snaps by exactly one grid pixel)
   *  - 'happy' squash-and-stretch hop, for post-workout XP gains
   */
  import {
    resolveColor,
    type SpriteAnimation,
    type SpriteGrid,
  } from '../lib/pets/sprites/types';

  let {
    grid,
    palette,
    size = 96,
    title = '',
    animation = 'none',
  }: {
    grid: SpriteGrid;
    palette: readonly [string, string, string, string];
    /** Rendered CSS size in px (the viewBox scales the grid up). */
    size?: number;
    title?: string;
    animation?: SpriteAnimation;
  } = $props();

  const pixels = $derived.by(() => {
    const out: { x: number; y: number; color: string }[] = [];
    for (let y = 0; y < grid.rows.length; y++) {
      const row = grid.rows[y];
      for (let x = 0; x < row.length; x++) {
        const color = resolveColor(row[x], palette);
        if (color) out.push({ x, y, color });
      }
    }
    return out;
  });
</script>

<svg
  viewBox={`0 0 ${grid.size} ${grid.size}`}
  width={size}
  height={size}
  role="img"
  aria-label={title || 'pixel sprite'}
  class:idle={animation === 'idle'}
  class:happy={animation === 'happy'}
  style={`shape-rendering: crispEdges; image-rendering: pixelated; --pet-px: ${size / grid.size}px;`}
>
  {#if title}<title>{title}</title>{/if}
  {#each pixels as p}
    <rect x={p.x} y={p.y} width="1" height="1" fill={p.color} />
  {/each}
</svg>

<style>
  svg {
    /* Squash from the feet, not the center. */
    transform-origin: 50% 100%;
  }

  .idle {
    animation: pet-bob 1s steps(1, end) infinite;
  }

  .happy {
    animation: pet-hop 0.9s cubic-bezier(0.36, 0.07, 0.19, 0.97) infinite;
  }

  @keyframes pet-bob {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(calc(-1 * var(--pet-px)));
    }
  }

  @keyframes pet-hop {
    0%,
    88%,
    100% {
      transform: translateY(0) scale(1, 1);
    }
    12% {
      /* anticipation crouch */
      transform: translateY(0) scale(1.12, 0.88);
    }
    42% {
      /* airborne stretch */
      transform: translateY(-28%) scale(0.94, 1.08);
    }
    68% {
      /* landing squash */
      transform: translateY(0) scale(1.08, 0.92);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .idle,
    .happy {
      animation: none;
    }
  }
</style>
