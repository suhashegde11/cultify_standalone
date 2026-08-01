"use strict";
const config = require('./config');
const { attemptBooking } = require('./index');

const TIMEZONE = config.timezone || 'Asia/Kolkata';
// The first booking check fires exactly at this time. Set it to the slot-open
// moment (10:00:00 PM) so the very first request lands in the opening second,
// instead of burning the rate-limit budget polling a still-closed endpoint.
const WINDOW_START = process.env.WINDOW_START || '22:00:00';
const WINDOW_END = process.env.WINDOW_END || '22:05:00';
// Before this cutoff the +4 day slot isn't open yet, so a run is treated as a
// status check: it attempts once and exits instead of waiting for WINDOW_START.
// At/after the cutoff, the run waits for WINDOW_START to snipe the opening.
const PRE_OPEN_CUTOFF = process.env.PRE_OPEN_CUTOFF || '21:00:00';
const RETRY_INTERVAL_MS = (parseInt(process.env.RETRY_INTERVAL_SECONDS, 10) || 2) * 1000;

// Backoff applied after cult.fit throttles us (429), its gateway errors (5xx),
// or a request times out - retrying at the normal short interval in those cases
// just keeps us flagged. Grows exponentially per consecutive failure, capped.
const BACKOFF_BASE_MS = (parseInt(process.env.BACKOFF_BASE_SECONDS, 10) || 3) * 1000;
const BACKOFF_MAX_MS = (parseInt(process.env.BACKOFF_MAX_SECONDS, 10) || 30) * 1000;

// Booking should stop retrying for the day once one of these outcomes is reached.
const TERMINAL_STATUSES = ['BOOKED', 'ALREADY_BOOKED', 'WAITLISTED'];
// Transient failures where we should back off rather than retry immediately.
const BACKOFF_STATUSES = ['RATE_LIMITED', 'SERVER_ERROR', 'NETWORK_ERROR'];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Builds today's date at HH:MM:SS in `timezone` as a real Date/instant,
// by reading today's Y-M-D and the zone's current UTC offset and combining them into an ISO string.
function todayAt(timeStr, timezone) {
    const now = new Date();

    const dateParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const y = dateParts.find(p => p.type === 'year').value;
    const m = dateParts.find(p => p.type === 'month').value;
    const d = dateParts.find(p => p.type === 'day').value;

    const offsetParts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'longOffset'
    }).formatToParts(now);
    const offset = offsetParts.find(p => p.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';

    return new Date(`${y}-${m}-${d}T${timeStr}${offset}`);
}

async function run() {
    const openTime = todayAt(WINDOW_START, TIMEZONE);
    const preOpenCutoff = todayAt(PRE_OPEN_CUTOFF, TIMEZONE);
    const windowEnd = todayAt(WINDOW_END, TIMEZONE);

    console.log(`+4 day opens at ${WINDOW_START}; snipe window ${WINDOW_START} - ${WINDOW_END} (${TIMEZONE})`);

    // Before the cutoff the +4 day slot isn't open yet, so this run is only a
    // status check: attempt once (reports already-booked/waitlisted, or books it
    // if it's somehow already open) and exit instead of sitting idle until 10PM.
    if (Date.now() < preOpenCutoff.getTime()) {
        console.log(`\n--- Status check at ${new Date().toISOString()} (before ${PRE_OPEN_CUTOFF} cutoff) ---`);
        const status = await attemptBooking();
        console.log(`Status check done (result: ${status}). Not waiting for the ${WINDOW_START} open.`);
        return;
    }

    // At/after the cutoff we're here to snipe: wait for the exact open moment,
    // then retry until the window closes.
    const untilStart = openTime.getTime() - Date.now();
    if (untilStart > 0) {
        console.log(`Waiting ${Math.round(untilStart / 1000)}s for the ${WINDOW_START} open...`);
        await sleep(untilStart);
    }

    let attempt = 0;
    let consecutiveBackoffs = 0;

    while (true) {
        attempt++;
        console.log(`\n--- Attempt ${attempt} at ${new Date().toISOString()} ---`);

        // Await the full website response before scheduling the next check, so
        // requests are strictly sequential and never pile up on top of each other.
        const status = await attemptBooking();

        if (TERMINAL_STATUSES.includes(status)) {
            console.log(`Stopping retry loop (status: ${status}).`);
            return;
        }

        let delayMs;
        if (BACKOFF_STATUSES.includes(status)) {
            consecutiveBackoffs++;
            delayMs = Math.min(BACKOFF_BASE_MS * 2 ** (consecutiveBackoffs - 1), BACKOFF_MAX_MS);
            console.log(`Backing off ${Math.round(delayMs / 1000)}s after ${status} (${consecutiveBackoffs} in a row).`);
        } else {
            consecutiveBackoffs = 0;
            delayMs = RETRY_INTERVAL_MS;
        }

        // Stop once the next attempt would fall outside the booking window.
        if (Date.now() + delayMs > windowEnd.getTime()) {
            break;
        }
        await sleep(delayMs);
    }

    console.log('Booking window closed without securing a class or waitlist spot.');
}

run();
