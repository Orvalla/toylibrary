// gift-advisor: the Toy Librarian (WS7 spec v1).
//
// Public by design (deploy with verify_jwt off); the guard rails are
// the controls in controls.js (spec §6): CORS apex +
// *.toylibrary.store, per-IP 30 turns/hour + 120/day, the $15/day
// breaker, and the advisor_enabled flag (ADVISOR_ENABLED secret,
// default OFF = 404 shape, the kill switch).
//
// Secrets read at runtime (none are needed to build or test):
//   ANTHROPIC_API_KEY   set by Morgan in the Supabase dashboard; when
//                       missing, the Librarian rests her voice (no 500).
//   ADVISOR_ENABLED     'true' turns the advisor on; anything else = off.
//   ADVISOR_IP_SALT     optional salt for the hashed-IP counters.
//
// The handler logic lives in advisor.js (runtime-neutral, tested
// under vitest with a mocked provider and store).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createHandler } from './advisor.js'
import { createAnthropicProvider } from './anthropic.js'
import { DAY_CAP, HOUR_CAP, MemoryLimiter } from './controls.js'
import { supabaseStore } from './store.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const limiter = new MemoryLimiter({ hourCap: HOUR_CAP, dayCap: DAY_CAP })
const store = supabaseStore(admin, { hourCap: HOUR_CAP, dayCap: DAY_CAP })

Deno.serve((req: Request) => {
  // Read per request so a secrets change (the kill switch, the key)
  // takes effect without a redeploy.
  const handle = createHandler({
    enabled: (Deno.env.get('ADVISOR_ENABLED') ?? '').trim().toLowerCase() === 'true',
    apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '',
    makeProvider: (apiKey: string) => createAnthropicProvider({ apiKey }),
    store,
    limiter,
    ipSalt: Deno.env.get('ADVISOR_IP_SALT') ?? 'toy-librarian',
    log: (level: string, msg: string) => (level === 'error' ? console.error(msg) : console.warn(msg)),
  })
  return handle(req)
})
