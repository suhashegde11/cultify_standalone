"use strict";
// Diagnostic ONLY. This script never books (no POST) - it just polls the classes
// list around slot-open time and logs seat availability, so you can see the exact
// moment the +4 day opens and how fast seats drain.
//
// It polls gently (default every 3s, starting only 30s before open, backing off
// 10s on any error) specifically so it can't trip cult.fit's rate limiter.
//
// It is fully standalone: it does not touch the workflow, run-booking-window.js,
// or the booking logic. Run it manually:  bun diagnose-open.js
const config = require('./config');
const { makeAPICall, commonHeaders, CURE_FIT_HOST, GET_CLASSES_URI, BOOKING_DAYS_AHEAD } = require('./index');

const TIMEZONE = config.timezone || 'Asia/Kolkata';
const PREFERRED_CENTER = config.preferredCenter || 1515;
const PREFERRED_SLOTS_CONFIG = config.preferredSlots || ['09:00:00'];

// Poll window and cadence - deliberately conservative to avoid rate limits.
const DIAG_START = process.env.DIAG_START || '21:59:30';
const DIAG_END = process.env.DIAG_END || '22:01:00';
const DIAG_INTERVAL_MS = (parseInt(process.env.DIAG_INTERVAL_SECONDS, 10) || 3) * 1000;
// After any error (e.g. a 429 or timeout) wait at least this long before polling
// again, so a diagnostic run can never turn into a hammering loop.
const DIAG_ERROR_BACKOFF_MS = (parseInt(process.env.DIAG_ERROR_BACKOFF_SECONDS, 10) || 10) * 1000;
const HTTP_GET = 'GET';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Same as index.js/run-booking-window.js: build today's date at HH:MM:SS in `timezone`.
function todayAt(timeStr, timezone) {
    const now = new Date();
    const dateParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const y = dateParts.find(p => p.type === 'year').value;
    const m = dateParts.find(p => p.type === 'month').value;
    const d = dateParts.find(p => p.type === 'day').value;
    const offsetParts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, timeZoneName: 'longOffset'
    }).formatToParts(now);
    const offset = offsetParts.find(p => p.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
    return new Date(`${y}-${m}-${d}T${timeStr}${offset}`);
}

// Same date-id logic as index.js: YYYY-MM-DD for "today + offsetDays" in `timezone`.
function getDateString(offsetDays, timezone) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const y = parseInt(parts.find(p => p.type === 'year').value, 10);
    const m = parseInt(parts.find(p => p.type === 'month').value, 10);
    const d = parseInt(parts.find(p => p.type === 'day').value, 10);
    const target = new Date(Date.UTC(y, m - 1, d));
    target.setUTCDate(target.getUTCDate() + offsetDays);
    return target.toISOString().slice(0, 10);
}

// Resolve which slots to watch for the target date, mirroring index.js's handling
// of either a flat array or a per-weekday object.
function resolveSlots(date) {
    if (PREFERRED_SLOTS_CONFIG && !Array.isArray(PREFERRED_SLOTS_CONFIG) && typeof PREFERRED_SLOTS_CONFIG === 'object') {
        const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toLowerCase();
        return PREFERRED_SLOTS_CONFIG[dayOfWeek] || PREFERRED_SLOTS_CONFIG['default'] || PREFERRED_SLOTS_CONFIG['any'] || ['09:00:00'];
    }
    return PREFERRED_SLOTS_CONFIG;
}

// All classes for a given slot id at the preferred center.
function classesForSlot(dayData, slot) {
    const timeSlot = (dayData.classByTimeList || []).find(t => t.id == slot);
    if (!timeSlot) {
        return null;
    }
    const center = (timeSlot.centerWiseClasses || []).find(c => c.centerId == PREFERRED_CENTER);
    return center ? center.classes : [];
}

// One diagnostic poll. Returns true on success, false if the request errored
// (so the caller backs off harder). Never books.
async function poll() {
    const stamp = new Date().toISOString();
    // Time the GET round trip so we can see whether network latency (a big
    // cross-region ping) or pure demand is the bottleneck. Declared out here so
    // the catch block can report how long a failed/timed-out request took too.
    const started = performance.now();
    try {
        const classes = await makeAPICall({}, CURE_FIT_HOST, GET_CLASSES_URI, HTTP_GET, commonHeaders);
        const getMs = Math.round(performance.now() - started);

        const date = getDateString(BOOKING_DAYS_AHEAD, TIMEZONE);
        const dayData = classes.classByDateMap && classes.classByDateMap[date];

        if (!dayData) {
            console.log(`${stamp}  ${date} (+${BOOKING_DAYS_AHEAD})  NOT OPEN YET  [GET took ${getMs}ms]`);
            return true;
        }

        const lines = [];
        for (const slot of resolveSlots(date)) {
            const list = classesForSlot(dayData, slot);
            if (list === null) {
                lines.push(`${slot}: (slot not present)`);
            } else if (list.length === 0) {
                lines.push(`${slot}: (no classes at center ${PREFERRED_CENTER})`);
            } else {
                for (const c of list) {
                    const waitlist = (c.waitlistInfo && c.waitlistInfo.waitlistedUserCount) || 0;
                    const seats = c.availableSeats != null ? c.availableSeats : 'n/a';
                    lines.push(`${slot} ${c.workoutName}: state=${c.state} seats=${seats} waitlist=${waitlist}`);
                }
            }
        }
        console.log(`${stamp}  ${date} (+${BOOKING_DAYS_AHEAD})  OPEN  [GET took ${getMs}ms]\n    ${lines.join('\n    ')}`);
        return true;
    } catch (error) {
        const failMs = Math.round(performance.now() - started);
        const tag = error.status || error.name || 'error';
        console.log(`${stamp}  REQUEST FAILED [${tag}] after ${failMs}ms: ${String(error.message || error).slice(0, 140)}`);
        return false;
    }
}

async function run() {
    const start = todayAt(DIAG_START, TIMEZONE);
    const end = todayAt(DIAG_END, TIMEZONE);

    console.log(`DIAGNOSTIC (log only, never books): watching +${BOOKING_DAYS_AHEAD} day at center ${PREFERRED_CENTER}`);
    console.log(`Window ${DIAG_START} - ${DIAG_END} (${TIMEZONE}), every ${DIAG_INTERVAL_MS / 1000}s, ${DIAG_ERROR_BACKOFF_MS / 1000}s backoff on error`);

    const untilStart = start.getTime() - Date.now();
    if (untilStart > 0) {
        console.log(`Waiting ${Math.round(untilStart / 1000)}s for ${DIAG_START}...`);
        await sleep(untilStart);
    }

    while (Date.now() <= end.getTime()) {
        // Sequential: wait for the response before scheduling the next poll.
        const ok = await poll();
        const delayMs = ok ? DIAG_INTERVAL_MS : DIAG_ERROR_BACKOFF_MS;
        if (Date.now() + delayMs > end.getTime()) {
            break;
        }
        await sleep(delayMs);
    }

    console.log('Diagnostic window closed.');
}

run();
