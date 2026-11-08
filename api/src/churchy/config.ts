export function churchyEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.CHURCHY_GAME_ENABLED === undefined || env.CHURCHY_GAME_ENABLED === 'true';
}
