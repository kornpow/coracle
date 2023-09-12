import {identity} from "ramda"
import {Engine} from "src/engine"

const IMGPROXY_URL = import.meta.env.VITE_IMGPROXY_URL

const DUFFLEPUD_URL = import.meta.env.VITE_DUFFLEPUD_URL

const MULTIPLEXTR_URL = import.meta.env.VITE_MULTIPLEXTR_URL

const FORCE_RELAYS = (import.meta.env.VITE_FORCE_RELAYS || "").split(",").filter(identity)

const COUNT_RELAYS = FORCE_RELAYS.length > 0 ? FORCE_RELAYS : ["wss://rbr.bio"]

const SEARCH_RELAYS = FORCE_RELAYS.length > 0 ? FORCE_RELAYS : ["wss://relay.nostr.band"]

const DEFAULT_RELAYS =
  FORCE_RELAYS.length > 0
    ? FORCE_RELAYS
    : [
        "wss://purplepag.es",
        "wss://relay.damus.io",
        "wss://relay.nostr.band",
        "wss://relayable.org",
        "wss://nostr.wine",
      ]

const DEFAULT_FOLLOWS = (import.meta.env.VITE_DEFAULT_FOLLOWS || "").split(",").filter(identity)

const ENABLE_ZAPS = JSON.parse(import.meta.env.VITE_ENABLE_ZAPS)

const engine = new Engine({
  DEFAULT_FOLLOWS,
  IMGPROXY_URL,
  DUFFLEPUD_URL,
  MULTIPLEXTR_URL,
  FORCE_RELAYS,
  COUNT_RELAYS,
  SEARCH_RELAYS,
  DEFAULT_RELAYS,
  ENABLE_ZAPS,
})

export default engine
export const Env = engine.Env
export const Directory = engine.Directory
export const Events = engine.Events
export const Keys = engine.Keys
