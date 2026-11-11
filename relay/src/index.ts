// relay.souspli.org -- the Worker. It does almost nothing: a WebSocket upgrade
// is handed to the one Durable Object that IS the relay; anything else gets the
// NIP-11 description or a paragraph saying what this address is.
import { THING_KIND } from './nostr'

export { Relay } from './relay'

export interface Env {
  RELAY: DurableObjectNamespace
  MAX_EVENTS: string
  MAX_CONTENT_BYTES: string
  EVENTS_PER_PUBKEY_PER_HOUR: string
  EVENTS_PER_IP_PER_HOUR: string
  BLOCKED_PUBKEYS: string
  /** Optional: keys exempt from the hourly limits (a publishing bot's). */
  TRUSTED_PUBKEYS?: string
  /** Optional: the name NIP-11 gives. */
  RELAY_NAME?: string
}

const INFO = (env: Env): Record<string, unknown> => ({
  name: env.RELAY_NAME || 'Souspli relay',
  description:
    'Carries Souspli letters (kind 3400) and nothing else. It adds reach, never authority: readers verify every letter themselves, and who posted one here is not who wrote it.',
  software: 'https://github.com/souspli/souspli/tree/master/relay',
  supported_nips: [1, 11],
  limitation: {
    max_content_length: Number(env.MAX_CONTENT_BYTES),
    max_subscriptions: 4,
    max_filters: 4,
    max_limit: 1000,
    auth_required: false,
    payment_required: false
  },
  retention: [{ kinds: [THING_KIND], count: Number(env.MAX_EVENTS) }]
})

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      // One object, one room: every subscriber must hear every post.
      return env.RELAY.get(env.RELAY.idFromName('main')).fetch(request)
    }
    if ((request.headers.get('Accept') ?? '').includes('application/nostr+json')) {
      return new Response(JSON.stringify(INFO(env)), {
        headers: { 'content-type': 'application/nostr+json', 'access-control-allow-origin': '*' }
      })
    }
    // Name the address this was reached at, so a second deployment (the news
    // relay) does not tell people to add the first one.
    return new Response(
      `This is ${env.RELAY_NAME || 'the Souspli relay'}: a Nostr relay that carries Souspli letters.\n` +
        `Add wss://${new URL(request.url).host} under File → Relays in the app. https://souspli.org\n`,
      { headers: { 'content-type': 'text/plain; charset=utf-8' } }
    )
  }
} satisfies ExportedHandler<Env>
