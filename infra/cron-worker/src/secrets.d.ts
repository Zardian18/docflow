// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them; declare them here.
interface Env {
  TICK_SECRET: string;
}
