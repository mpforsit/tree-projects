/**
 * Alarm worker — invoked every 30 min by a Coolify scheduled task (spec §12).
 * M0 placeholder: logs a heartbeat. Becomes the alarm engine in M5, when it
 * will call the alarm evaluation SQL function once per pass.
 */
import { log } from "../lib/log.ts";

log.info("alarm worker heartbeat — evaluation function lands in M5");
