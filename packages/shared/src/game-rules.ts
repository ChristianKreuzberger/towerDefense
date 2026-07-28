export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const WIN_SCORE = 1000;

export const GAME_RULES = {
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  winScore: WIN_SCORE,
  towersPerPlayer: 1
} as const;
