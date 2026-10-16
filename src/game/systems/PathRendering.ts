import type { PathConnections } from './ProceduralWorld';

export type PathFrame = 8 | 9 | 10 | 11;

export interface PathRenderPiece {
  frame: PathFrame;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

const FRAME_SIZE = 313;
const CENTER = Math.ceil(FRAME_SIZE / 2);
const CENTER_START = 70;
const CENTER_SIZE = FRAME_SIZE - CENTER_START * 2;
const ARM_INSET = 34;
const ARM_WIDTH = FRAME_SIZE - ARM_INSET * 2;

const fullFrame = (frame: PathFrame): PathRenderPiece => ({
  frame,
  cropX: 0,
  cropY: 0,
  cropWidth: FRAME_SIZE,
  cropHeight: FRAME_SIZE,
});

export const getPathRenderPieces = (connections: PathConnections): PathRenderPiece[] => {
  const active = Object.entries(connections)
    .filter(([, connected]) => connected)
    .map(([direction]) => direction as keyof PathConnections);

  if (active.length === 2) {
    if (connections.west && connections.east) return [fullFrame(8)];
    if (connections.north && connections.south) return [fullFrame(9)];
    if (connections.northEast && connections.southWest) return [fullFrame(10)];
    if (connections.northWest && connections.southEast) return [fullFrame(11)];
  }

  const pieces: PathRenderPiece[] = [];
  if (connections.west) pieces.push({ frame: 8, cropX: 0, cropY: ARM_INSET, cropWidth: CENTER + 18, cropHeight: ARM_WIDTH });
  if (connections.east) pieces.push({ frame: 8, cropX: CENTER - 18, cropY: ARM_INSET, cropWidth: CENTER + 17, cropHeight: ARM_WIDTH });
  if (connections.north) pieces.push({ frame: 9, cropX: ARM_INSET, cropY: 0, cropWidth: ARM_WIDTH, cropHeight: CENTER + 18 });
  if (connections.south) pieces.push({ frame: 9, cropX: ARM_INSET, cropY: CENTER - 18, cropWidth: ARM_WIDTH, cropHeight: CENTER + 17 });
  if (connections.northEast) pieces.push({ frame: 10, cropX: CENTER - 18, cropY: 0, cropWidth: CENTER + 17, cropHeight: CENTER + 18 });
  if (connections.southWest) pieces.push({ frame: 10, cropX: 0, cropY: CENTER - 18, cropWidth: CENTER + 18, cropHeight: CENTER + 17 });
  if (connections.northWest) pieces.push({ frame: 11, cropX: 0, cropY: 0, cropWidth: CENTER + 18, cropHeight: CENTER + 18 });
  if (connections.southEast) pieces.push({ frame: 11, cropX: CENTER - 18, cropY: CENTER - 18, cropWidth: CENTER + 17, cropHeight: CENTER + 17 });

  const centerFrame: PathFrame = connections.west || connections.east
    ? 8
    : connections.north || connections.south
      ? 9
      : connections.northEast || connections.southWest
        ? 10
        : 11;
  pieces.push({
    frame: centerFrame,
    cropX: CENTER_START,
    cropY: CENTER_START,
    cropWidth: CENTER_SIZE,
    cropHeight: CENTER_SIZE,
  });
  return pieces;
};
