import { callTick } from './tick';

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      callTick(env).then((status) => {
        console.log(`tick ok (HTTP ${status}) for cron "${controller.cron}"`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
