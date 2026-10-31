import { createReminderTickHandler } from './core.generated.js';
import { createReminderRuntime } from './runtime.ts';

// The gateway's verify_jwt=false is intentional: only this dedicated cron token
// authorizes the lazy factory, never an anon key or ordinary user JWT.
const env = (name: string) => Deno.env.get(name);
Deno.serve(createReminderTickHandler(env('DAYPOP_REMINDER_TOKEN'), () => createReminderRuntime(env)));
