import { Agent, setGlobalDispatcher } from 'undici'

// This host resolves outbound hostnames (Resend's API, npm's registry, etc.)
// to IPv6 addresses that it has no real route to (only a link-local ::1/fe80
// address, no global IPv6 connectivity) alongside working IPv4 addresses.
// Node's fetch (undici) doesn't reliably fall back to IPv4 fast enough,
// so third-party API calls (e.g. Resend) intermittently hang and fail with
// "Unable to fetch data. The request could not be resolved." Forcing every
// outbound fetch connection to IPv4 sidesteps the dead IPv6 route entirely.
setGlobalDispatcher(new Agent({ connect: { family: 4 } }))
