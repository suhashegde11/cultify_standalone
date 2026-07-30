"use strict";
const config = require('./config'),
    /*
    Maintaining a list of activities and my preference
    The id field is the workoutId which part of classes object as a response of `api/cult/classes/` API
    */

    ActivityType = {
        "hrx": {
            "id": 69,
            "name": "HRX WORKOUT",
            "displayText": "HRX WORKOUT",
            "preference": 1
        },
        "strength": {
            "id": 69,
            "name": "ADIDAS STRENGTH+",
            "displayText": "ADIDAS STRENGTH+",
            "preference": 2
        },
        "yoga": {
            "id": 5,
            "name": "EVOLVE YOGA",
            "displayText": "EVOLVE YOGA",
            "preference": 3
        },
        "dance": {
            "id": 56,
            "name": "DANCE FITNESS",
            "displayText": "DANCE FITNESS",
            "preference": 4
        },
        "burn": {
            "id": 66,
            "name": "BURN",
            "displayText": "BURN",
            "preference": 5
        },
        "boxing": {
            "id": 8,
            "name": "BOXING BAG WORKOUT",
            "displayText": "BOXING BAG WORKOUT",
            "preference": 6
        },
        "fusionDance": {
            "id": 56,
            "name": "FUSION DANCE FITNESS",
            "displayText": "FUSION DANCE FITNESS",
            "preference": 7
        }
    };

const commonHeaders = {
    "accept": "application/json",
    "apikey": config.apiKey,
    "appversion": config.appVersion,
    "browsername": config.browserName,
    "osname": config.osName,
    "timezone": config.timezone,
    "content-type": "application/json",
    "Cookie": config.cookies
};
const CURE_FIT_HOST = "www.cult.fit";
const URI = {
    "GET_CLASSES": "/api/cult/classes/v2?productType=FITNESS",
    "BOOK_CLASS": "/api/cult/class/${activityID}/book"
};
const HTTP_POST = "POST",
    HTTP_GET = "GET";
const REQUEST_TIMEOUT_MS = 3000;


const PREFERRED_SLOTS_CONFIG = config.preferredSlots || ['09:00:00'];
const PREFERRED_CENTER = config.preferredCenter || 1515;
const PREFERRED_WORKOUT_NAMES = config.preferredWorkout || ["HRX WORKOUT"];
const ENABLE_WAITLIST = config.enableWaitlist !== false;
const BOOKING_DAYS_AHEAD = parseInt(process.env.BOOKING_DAYS_AHEAD, 10) || 4;

// Preference order follows PREFERRED_WORKOUT_NAMES, not the hardcoded ActivityType.preference values
const PREFERRED_CLASSES_IN_ORDER = PREFERRED_WORKOUT_NAMES
    .map((name, index) => {
        const activity = Object.values(ActivityType).find(activity => activity.name === name);
        return activity ? { ...activity, preference: index + 1 } : null;
    })
    .filter(Boolean);

// Returns the YYYY-MM-DD string for "today + offsetDays" as seen in `timezone`,
// matching the date-id format cult.fit uses in classes.classByDateMap.
function getDateString(offsetDays, timezone) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const y = parseInt(parts.find(p => p.type === 'year').value, 10);
    const m = parseInt(parts.find(p => p.type === 'month').value, 10);
    const d = parseInt(parts.find(p => p.type === 'day').value, 10);

    const target = new Date(Date.UTC(y, m - 1, d));
    target.setUTCDate(target.getUTCDate() + offsetDays);
    return target.toISOString().slice(0, 10);
}

function hasBookingForDate(classesForDay) {
    for (let timeSlot of classesForDay.classByTimeList) {
        for (let centerClass of timeSlot.centerWiseClasses) {
            if (centerClass.centerId === PREFERRED_CENTER) {
                for (let classs of centerClass.classes) {
                    if (classs.state === 'BOOKED' || classs.isBooked === true) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

// Returns a status describing the outcome, so a caller retrying across a time
// window knows when to stop: 'BOOKED' | 'ALREADY_BOOKED' | 'WAITLISTED' | 'NOT_OPEN_YET' | 'NO_MATCH' | 'ERROR'
async function attemptBooking() {
    try {
        let classes = await makeAPICall({}, CURE_FIT_HOST, URI.GET_CLASSES, HTTP_GET, commonHeaders);
        let date = getDateString(BOOKING_DAYS_AHEAD, config.timezone);

        const dayData = classes.classByDateMap[date];
        if (!dayData) {
            // cult.fit hasn't opened this date's slots yet - not a failure, keep retrying.
            console.log(`${date} (day +${BOOKING_DAYS_AHEAD}) is not open for booking yet.`);
            return 'NOT_OPEN_YET';
        }

        console.log(`Booking for ${date}`);

        if (hasBookingForDate(dayData)) {
            console.log(`Already booked on ${date}. Skipping.`);
            return 'ALREADY_BOOKED';
        }

        // Determine the day of the week (e.g., "monday", "tuesday")
        const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toLowerCase();
        
        let preferredSlotsForDay;
        if (PREFERRED_SLOTS_CONFIG && !Array.isArray(PREFERRED_SLOTS_CONFIG) && typeof PREFERRED_SLOTS_CONFIG === 'object') {
            preferredSlotsForDay = PREFERRED_SLOTS_CONFIG[dayOfWeek];
            if (!preferredSlotsForDay) {
                preferredSlotsForDay = PREFERRED_SLOTS_CONFIG['default'] || PREFERRED_SLOTS_CONFIG['any'] || ['09:00:00'];
            }
        } else {
            preferredSlotsForDay = PREFERRED_SLOTS_CONFIG;
        }

        console.log(`Preferred slots for ${dayOfWeek}: ${preferredSlotsForDay.join(', ')}`);

        // Pass 1: book the first open seat, trying preferred workouts in order
        // (all preferred slots are checked for a workout before moving to the next workout)
        for (let workout of PREFERRED_CLASSES_IN_ORDER) {
            for (let slot of preferredSlotsForDay) {
                let available = getSlots(dayData, slot, [workout], ['AVAILABLE']);

                if (available.length > 0) {
                    let classInfo = available[0];
                    console.log(`Found ${classInfo.workoutName} at ${slot} on ${date}`);
                    console.log(`Booking (${classInfo.availableSeats} seats available)`);
                    await bookClass(classInfo.id);
                    console.log("Class booked successfully!");
                    return 'BOOKED';
                }
            }
        }

        console.log(`No ${PREFERRED_WORKOUT_NAMES.join(' or ')} classes available on ${date}`);

        if (!ENABLE_WAITLIST) {
            return 'NO_MATCH';
        }

        // Pass 2: no open seats in any preferred slot - join whichever preferred slot has the shortest waitlist
        let waitlistCandidates = [];
        for (let slot of preferredSlotsForDay) {
            for (let classInfo of getSlots(dayData, slot, PREFERRED_CLASSES_IN_ORDER, ['WAITLIST_AVAILABLE'])) {
                waitlistCandidates.push({ slot, classInfo });
            }
        }

        if (waitlistCandidates.length === 0) {
            console.log(`No waitlist spots available on ${date}`);
            return 'NO_MATCH';
        }

        // Workout preference (HRX before ADIDAS STRENGTH+) wins first; minimum waitlist count
        // is only a tiebreaker between slots/times for the same workout.
        waitlistCandidates.sort((a, b) => {
            if (a.classInfo.preference !== b.classInfo.preference) {
                return a.classInfo.preference - b.classInfo.preference;
            }
            let countA = (a.classInfo.waitlistInfo && a.classInfo.waitlistInfo.waitlistedUserCount) || 0;
            let countB = (b.classInfo.waitlistInfo && b.classInfo.waitlistInfo.waitlistedUserCount) || 0;
            return countA - countB;
        });

        let best = waitlistCandidates[0];
        let waitlistCount = (best.classInfo.waitlistInfo && best.classInfo.waitlistInfo.waitlistedUserCount) || 0;
        console.log(`Joining waitlist for ${best.classInfo.workoutName} at ${best.slot} (${waitlistCount} people ahead)`);
        await bookClass(best.classInfo.id);
        console.log("Joined waitlist successfully!");
        return 'WAITLISTED';
    } catch (error) {
        errorHandler(error);
        return 'ERROR';
    }
}

if (require.main === module) {
    attemptBooking();
}

module.exports = { attemptBooking, makeAPICall, commonHeaders, CURE_FIT_HOST, GET_CLASSES_URI: URI.GET_CLASSES };


async function bookClass(activityID) {
    return await makeAPICall({}, CURE_FIT_HOST, "/api/cult/class/" + activityID + "/book", HTTP_POST, commonHeaders);
}

async function makeAPICall(request, host, path, method, headers) {
    if (config.userAgent) {
        headers['User-Agent'] = config.userAgent;
    }
    if (config.referer) {
        headers['referer'] = config.referer;
    }

    const url = `https://${host}${path}`;
    const options = {
        method: method,
        headers: headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    };

    if (method === 'POST') {
        options.body = JSON.stringify(request);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return await response.json();
    }

    return await response.text();
}

function getSlots(classesForDay, slot, classTypes, allowedStates) {

    let timeSlot = classesForDay.classByTimeList.filter(function (classByTime) {
        return classByTime.id == slot;
    })[0];

    if (!timeSlot) {
        return [];
    }

    let centerClasses = timeSlot.centerWiseClasses.filter(function (center) {
        return center.centerId == PREFERRED_CENTER;
    })[0];

    if (!centerClasses) {
        return [];
    }

    let classIDs = centerClasses.classes.filter(function (classs) {
        let filterElement = classTypes.filter(function (classType) {
            return classType.id == classs.workoutId && classType.name == classs.workoutName
        })[0];
        if (!filterElement) {
            return false;
        }
        classs.preference = filterElement.preference;

        return allowedStates.includes(classs.state);
    })
    .sort(function (class1, class2) {
        return class1.preference - class2.preference;
    });

    return classIDs;
}

function errorHandler(error) {
    console.error("Booking failed:", error);
}