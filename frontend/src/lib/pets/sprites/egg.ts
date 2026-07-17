import type { SpriteGrid } from './types';

/** The one shared egg sprite — tinted per species at reveal time. */
export const EGG_PALETTE: [string, string, string, string] = [
  '#7a7466', // outline
  '#f2ead8', // shell
  '#d8cdb4', // shadow
  '#b8ad92', // spots
];

export const EGG_SPRITE: SpriteGrid = {
  size: 16,
  rows: [
    '................',
    '................',
    '......1111......',
    '.....122221.....',
    '....12222221....',
    '....12242221....',
    '...1222222221...',
    '...1224222421...',
    '...1222222221...',
    '...1222242221...',
    '...1322222231...',
    '...1332222331...',
    '....13322331....',
    '.....133331.....',
    '......1111......',
    '................',
  ],
};
