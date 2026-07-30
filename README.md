# Cultify

Automated Cult.fit class booking system using GitHub Actions.

## Overview

Cultify is an automation tool that books fitness classes at Cult.fit centers. It authenticates using browser session cookies and runs automatically via GitHub Actions, eliminating the need for manual booking.

**TL;DR:** Fork this repo → Add your Cult.fit login curl to GitHub Secrets → Enable Actions → Done! Classes book automatically.

## Features

- Automatic class booking based on preferences
- Configurable workout types, time slots, and centers
- Explicit day-ahead targeting (`BOOKING_DAYS_AHEAD`, default 4) — computes today + N days directly instead of guessing from the API response, and keeps retrying until that date's slots actually open
- Smart booking logic (skips if already booked, or already waitlisted, for the target date)
- Waitlist support (joins queue when classes are full)
- GitHub Actions integration for automated scheduling
- Zero server costs (runs on GitHub infrastructure)
- Secure credential management via GitHub Secrets
- No installation required - just fork and configure!
- It keeps checking for cookies expiry everyday at 9AM and notifies you via email (if enabled by git for failure) that cookies expired.
  

## Why Cultify?

**No More Manual Booking!** Classes at Cult.fit fill up fast, especially popular morning slots. Cultify automatically books your preferred class as soon as booking opens, so you never miss your workout.

**3-Minute Setup:** Fork → Add credentials → Enable Actions. That's it! No coding, no servers, no maintenance.

**100% Free:** Runs on GitHub's infrastructure at no cost to you.

## How It Works

1. Extracts authentication from browser curl command (cookies path)
2. Computes the target date as **today + `BOOKING_DAYS_AHEAD` days** (default 4) in your configured timezone
3. Fetches available classes via Cult.fit API
4. If the target date hasn't opened for booking yet, logs that and keeps retrying (via `run-booking-window.js`) instead of evaluating an earlier, already-booked day
5. Checks for an existing booking or waitlist entry on the target date — stops immediately if either exists
6. Filters by configured preferences (center, time, workout type)
7. Books first available matching class according to the preference, or joins the shortest waitlist if none are available
8. Logs results (workout + date) for monitoring

## Prerequisites

- Active Cult.fit membership
- GitHub account
- Node.js 18+ (for local testing only)

## Quick Start (Recommended)

Get started in 3 simple steps - no installation or coding required!

### Step 1: Fork Repository

1. Click the "Fork" button at the top right of this repository
2. This creates your own copy of Cultify in your GitHub account

### Step 2: Get Authentication

You need your Cult.fit session cookie:

1. Navigate to https://www.cult.fit and log in
2. Open DevTools (F12, or Cmd+Option+I on Mac)
3. Click the **Network** tab in the DevTools toolbar
4. Refresh the page (Cmd+R / F5) so requests populate in the left-hand request list
5. In the filter bar just below the Network tab, click **Fetch/XHR** to narrow the list
6. Click any request going to `cult.fit` (e.g. one named `v2`, `cities`, or `classes`)
7. In the right-hand panel, make sure the **Headers** sub-tab is selected
8. Scroll down to the **Request Headers** section
9. Find the row starting with `cookie:` — hover over it, click the small copy icon that appears (or select the text manually), and copy everything **after** `cookie: `

Your copied value should look like:
st...deviceId=...; at=s%3ACFAPP%3A...; st=s%3ACFAPP%3A...; ...

**Important:** Copy only the value (the `name=value; name=value; ...` string) — do not include the `cookie:` label itself, and don't wrap it in quotes.

And the corresponding secret in Step 3:

**Required:**
- Name: `COOKIES`
- Value: The cookie string you copied in Step 2


### Step 3: Configure & Enable

**Part A: Add GitHub Secrets**

1. Go to your forked repository on GitHub
2. Navigate to: **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the following secret:

**Required:**
- Name: `COOKIES`
- Value: Your complete cookies value fetched in above step

**Optional Secrets** (customize if needed):

| Secret Name | Description | Default | Example |
|-------------|-------------|---------|---------|
| `PREFERRED_CENTER` | Your gym center ID | 1515 | 151 |
| `PREFERRED_SLOTS` | Comma-separated time slots | 07:00:00,08:00:00,09:00:00 | 18:00:00,19:00:00 |
| `PREFERRED_WORKOUT` | Workout class name | HRX WORKOUT | DANCE FITNESS |
| `ENABLE_WAITLIST` | Join waitlist when full | true | false |
| `BOOKING_DAYS_AHEAD` | How many days ahead of today to target | 4 | 4 |

**Part B: Enable GitHub Actions**

1. Go to the **Actions** tab in your forked repository
2. Click "I understand my workflows, go ahead and enable them"
3. Select "Auto Book Cult Class" workflow
4. Click "Enable workflow" if needed

**That's it!** The workflow starts daily at 9:54 PM IST and retries every 5 seconds through the 9:56-10:05 PM IST window (when slots typically open) until it books a class or the window closes.

### Manual Trigger

You can trigger booking immediately without waiting:

1. Go to **Actions** tab
2. Select **"Auto Book Cult Class"** workflow
3. Click **"Run workflow"** button
4. Click **"Run workflow"** to confirm

### Monitor Bookings

Check if your class was booked:

1. Navigate to **Actions** tab
2. Select the latest workflow run
3. Click on the job to view logs
4. Look for success message: "Class booked successfully!"

## Configuration Details

### Finding Your Center ID

If you want to use a specific gym center:

1. Keep the default configuration first
2. Run the workflow once (it will fail but show available centers)
3. Check the logs in Actions tab
4. Look for center IDs in the output:

```json
{
  "151": { "centerName": "Cult HSR Layout" },
  "634": { "centerName": "Cult Koramangala" }
}
```

5. Add `PREFERRED_CENTER` secret with your center ID

### Environment Variable Reference

#### CURL_COMMAND (Required)

Complete curl command from browser. Must be provided as single line (remove backslashes).

```bash
CURL_COMMAND=curl 'https://www.cult.fit/api/...' -H 'apikey: ...' -b '...' -H 'osname: browser'
```

#### BOOKING_DAYS_AHEAD (Optional)

How many days ahead of today (in your configured timezone) the script should target for booking.

**Default:** 4

**Example:**
```bash
BOOKING_DAYS_AHEAD=4
```

**Behavior:**

The script always computes the target date as *today + `BOOKING_DAYS_AHEAD` days*, instead of assuming "whatever date the Cult.fit API currently lists last." If that date hasn't opened for booking yet, the script logs it and returns a non-terminal status so `run-booking-window.js` keeps retrying until the date actually appears — it won't report a false "already booked" based on an earlier day that was booked in a previous run.

#### PREFERRED_CENTER (Optional)

Numeric ID of your preferred Cult.fit center.

**Default:** 1515

**Example:**
```bash
PREFERRED_CENTER=151
```

#### PREFERRED_SLOTS (Optional)

Time slots in 24-hour format (HH:MM:SS), tried in order until one is available. Supports two formats:

**1. Comma-separated list** — same slots every day.

**Default:** 07:00:00,08:00:00,09:00:00

**Example:**
```bash
PREFERRED_SLOTS=07:00:00,08:00:00,09:00:00
```

**2. JSON map keyed by day of week** — different slots per day, with an optional `default`/`any` fallback for days not listed.

**Example:**
```bash
PREFERRED_SLOTS={"monday":["06:00:00"],"wednesday":["07:00:00","08:00:00"],"default":["09:00:00"]}
```

The script looks up the booking date's day of week (e.g. `monday`) in the map. If that day isn't present, it falls back to `default`, then `any`, then `09:00:00`.

Script attempts slots in order and books first available match.

**Common Time Slots:**
- Morning: 06:00:00, 07:00:00, 08:00:00, 09:00:00, 10:00:00
- Evening: 17:00:00, 18:00:00, 19:00:00, 20:00:00

#### PREFERRED_WORKOUT (Optional)

Exact name of workout class to book. Case-sensitive.

**Default:** HRX WORKOUT

**Example:**
```bash
PREFERRED_WORKOUT=HRX WORKOUT
```

**Available Workouts:**

| Workout Name | Category ID |
|--------------|-------------|
| HRX WORKOUT | 69 |
| ADIDAS STRENGTH+ | 69 |
| DANCE FITNESS | 56 |
| FUSION DANCE FITNESS | 56 |
| BOXING BAG WORKOUT | 8 |
| BURN | 66 |
| EVOLVE YOGA | 5 |

#### ENABLE_WAITLIST (Optional)

Enable or disable waitlist booking when classes are full.

**Default:** true

**Example:**
```bash
ENABLE_WAITLIST=true
```

**Behavior:**

When enabled (`true`):
- Books available classes normally
- Joins waitlist if class is full
- Logs waitlist position

When disabled (`false`):
- Only books classes with available seats
- Skips full classes
- Continues to next time slot

**Waitlist Information:**

When joining waitlist, output shows:
```
Found HRX WORKOUT class at 07:00:00 on 2025-11-26
Class ID: 7360552
Status: WAITLIST (5 people already waitlisted)
Action: Joining waitlist...
Class booked successfully!
```

If you get a spot from waitlist, Cult.fit will notify you via app/email.

**Already Waitlisted:**

If you're already on the waitlist for the target date (e.g. from a previous run), the script won't try booking or joining another slot's/workout's waitlist — it immediately reports the existing status and stops:

```
CULT ADIDAS STRENGTH+ already waitlisted for August 3rd, 2026. Skipping further booking attempts.
```

#### DEBUG (Optional)

Enable detailed logging to debug booking issues.

**Default:** false

**Example:**
```bash
DEBUG=true
```

**Debug Output:**

Shows all classes at each time slot:
```
[DEBUG] Slot 07:00:00: Found 2 classes at center
  - HRX WORKOUT: AVAILABLE, seats: 2, waitlist: 0
  - DANCE FITNESS: WAITLIST_AVAILABLE, seats: 0, waitlist: 29
[DEBUG] After filtering: 1 matching classes
```

Use debug mode to troubleshoot:
- Why no classes are found
- What classes exist at each time slot
- Waitlist information
- Filtering logic

## Customizing Schedule

By default the workflow starts at **9:54 PM IST** and `run-booking-window.js` retries every 5 seconds through the **9:56-10:05 PM IST** window (when slots typically open), stopping as soon as it books a class, joins a waitlist, or finds you're already booked.

To change the window:

1. Edit `.github/workflows/book-class.yml` in your forked repository
2. Update the `WINDOW_START` / `WINDOW_END` env values (and `RETRY_INTERVAL_SECONDS` if you want a different retry cadence):

```yaml
env:
  WINDOW_START: '21:56:00'
  WINDOW_END: '22:05:00'
  RETRY_INTERVAL_SECONDS: '5'
```

3. Also update the cron trigger so the job starts a couple of minutes before `WINDOW_START` (to account for checkout/install time):

```yaml
on:
  schedule:
    - cron: '24 16 * * *'  # minute hour day month weekday (UTC) - 2 min before WINDOW_START
```

**Tip:** Cult.fit typically opens next-day booking around 10:00 PM IST, but the exact moment can vary by a few minutes - hence the retry window instead of a single fixed time.

To test locally without waiting for the real window, override the times directly:

```bash
WINDOW_START=09:00:00 WINDOW_END=09:00:30 RETRY_INTERVAL_SECONDS=5 node run-booking-window.js
```

## Expected Output

When checking workflow logs in Actions tab, you'll see:

**Booked:**
```
Booking for 2026-08-03
Preferred slots for monday: 07:00:00, 08:00:00, 09:00:00
Found HRX WORKOUT at 07:00:00 on 2026-08-03
Booking (2 seats available)
CULT HRX WORKOUT booked for August 3rd, 2026.
```

**Waitlisted:**
```
Booking for 2026-08-03
Preferred slots for monday: 07:00:00, 08:00:00, 09:00:00
No HRX WORKOUT classes available on 2026-08-03
Joining waitlist for ADIDAS STRENGTH+ at 08:00:00 (5 people ahead)
CULT ADIDAS STRENGTH+ waitlisted for August 3rd, 2026.
```

**Already Booked:**
```
Booking for 2026-08-03
CULT HRX WORKOUT already booked for August 3rd, 2026.
```

**Already Waitlisted:**
```
Booking for 2026-08-03
CULT ADIDAS STRENGTH+ already waitlisted for August 3rd, 2026. Skipping further booking attempts.
```

**Target Date Not Open Yet:**
```
2026-08-03 (day +4) is not open for booking yet.
```

## Local Testing (Optional)

For developers who want to test locally before deploying:

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/cultify.git
cd cultify
npm install  # or bun install
```

### Create .env File

```bash
CURL_COMMAND=curl 'https://www.cult.fit/api/...' -H 'apikey: ...' -b '...'
PREFERRED_CENTER=1515
PREFERRED_SLOTS=07:00:00,08:00:00,09:00:00
PREFERRED_WORKOUT=HRX WORKOUT
ENABLE_WAITLIST=true
```

**Important:** Remove all backslashes from curl command. It must be single line.

### Run Script

```bash
node index.js
# or
bun index.js
```

## Configuration Examples

Add these as GitHub Secrets (Settings → Secrets and variables → Actions):

### Example 1: Default Morning HRX

**Required Secret:**
- `CURL_COMMAND`: Your curl command

Uses defaults: Center 1515, 7-9 AM slots, HRX WORKOUT

### Example 2: Evening Dance Classes

**Secrets:**
- `CURL_COMMAND`: Your curl command
- `PREFERRED_SLOTS`: `18:00:00,19:00:00,20:00:00`
- `PREFERRED_WORKOUT`: `DANCE FITNESS`

### Example 3: Different Center

**Secrets:**
- `CURL_COMMAND`: Your curl command
- `PREFERRED_CENTER`: `634`
- `PREFERRED_WORKOUT`: `BURN`

### Example 4: Disable Waitlist

**Secrets:**
- `CURL_COMMAND`: Your curl command
- `ENABLE_WAITLIST`: `false`

Only books classes with available seats. Skips full classes.

### Example 5: Full Customization

**Secrets:**
- `CURL_COMMAND`: Your curl command
- `PREFERRED_CENTER`: `634`
- `PREFERRED_SLOTS`: `17:00:00,18:00:00`
- `PREFERRED_WORKOUT`: `BOXING BAG WORKOUT`
- `ENABLE_WAITLIST`: `true`

## Troubleshooting

### Authentication Errors

**Error Message:**
```
Login Required!
```

**Cause:** Session cookies expired (typically after 7-30 days)

**Solution:**
1. Get fresh curl command from browser (see Step 2 in Quick Start)
2. Update `CURL_COMMAND` GitHub Secret in your repository
3. Manually trigger workflow to test (Actions → Run workflow)

### No Classes Found

**Error Message:**
```
No HRX classes available between 7-9 AM on 2025-11-26
```

**Possible Causes:**
- No classes scheduled at configured times
- All classes full
- Wrong workout name
- Wrong center ID

**Solution:**
1. Verify class availability on Cult.fit website
2. Check PREFERRED_WORKOUT matches exactly
3. Confirm PREFERRED_CENTER is correct
4. Try different time slots

### Already Booked

**Message:**
```
CULT HRX WORKOUT already booked for August 3rd, 2026.
```

**Explanation:** Script detected an existing booking for the target date (today + `BOOKING_DAYS_AHEAD`). This is expected behavior to prevent double booking, and the retry loop stops.

### Already Waitlisted

**Message:**
```
CULT ADIDAS STRENGTH+ already waitlisted for August 3rd, 2026. Skipping further booking attempts.
```

**Explanation:** Script detected an existing waitlist entry for the target date. It won't try booking or waitlisting another slot/workout for the same day — this is expected behavior to avoid stacking multiple waitlist entries.

### Workflow Not Running

**Check These:**

1. **Actions Enabled?**
   - Go to Actions tab
   - If you see "Workflows disabled", click "I understand my workflows, go ahead and enable them"

2. **Secrets Configured?**
   - Go to Settings → Secrets and variables → Actions
   - Verify `CURL_COMMAND` secret exists and is not empty

3. **Workflow Enabled?**
   - Go to Actions → "Auto Book Cult Class"
   - If disabled, click the three dots → Enable workflow

4. **Manual Test:**
   - Actions → "Auto Book Cult Class" → "Run workflow"
   - Check logs for any errors

## Advanced Usage

### Project Structure

```
cultify/
├── .github/
│   └── workflows/
│       └── book-class.yml    # GitHub Actions workflow
├── config.js                  # Configuration parser
├── index.js                   # Single booking attempt (exports attemptBooking)
├── run-booking-window.js      # Retries attemptBooking across the booking window
├── package.json              # Dependencies
├── .env                      # Local testing only (gitignored)
├── .gitignore               # Git ignore rules
└── README.md                # Documentation
```

### Code Overview

**config.js**
- Parses curl command
- Extracts authentication headers
- Provides configuration to main script

**index.js**
- Defines workout types and preferences
- Computes the explicit target date (today + `BOOKING_DAYS_AHEAD`, default 4) rather than assuming the API's last-listed day; returns a `NOT_OPEN_YET` status if that date isn't open yet
- Fetches available classes
- Skips booking/waitlist attempts entirely if already booked, or already waitlisted, for the target date
- Filters by preferences
- Handles booking logic
- Exports `attemptBooking()` for reuse by `run-booking-window.js`; runs once immediately when executed directly

**run-booking-window.js**
- Calls `attemptBooking()` on a retry loop (default every 5s) across `WINDOW_START`-`WINDOW_END`
- Stops early once a class is booked, a waitlist is joined, or a booking already exists for the date
- Used by the GitHub Actions workflow instead of running `index.js` once

**book-class.yml**
- Defines GitHub Actions workflow
- Sets schedule (starts a couple minutes before `WINDOW_START`)
- Configures environment

### Adding New Workout Types

Edit `index.js` ActivityType object:

```javascript
ActivityType = {
    "newWorkout": {
        "id": XX,
        "name": "EXACT WORKOUT NAME",
        "displayText": "Display Name",
        "preference": 1
    }
}
```

Find workout ID and name from API response in logs.

### Modifying Booking Logic

Main booking flow in `index.js`:

```javascript
async function attemptBooking() {
    // 1. Fetch classes
    let classes = await makeAPICall(...);

    // 2. Compute the explicit target date (today + BOOKING_DAYS_AHEAD)
    let date = getDateString(BOOKING_DAYS_AHEAD, config.timezone);
    if (!classes.classByDateMap[date]) return 'NOT_OPEN_YET';

    // 3. Check existing booking / waitlist status for that date
    const { bookedClass, waitlistedClass } = findUserClassStatusForDate(...);
    if (bookedClass) return 'ALREADY_BOOKED';
    if (waitlistedClass) return 'WAITLISTED';

    // 4. Try each time slot, in preference order
    for (let slot of preferredSlotsForDay) {
        slots = getSlots(...);
        if (slots.length > 0) {
            // 5. Book first match
            await bookClass(slots[0].id);
            return 'BOOKED';
        }
    }
    // ...falls through to joining a waitlist if ENABLE_WAITLIST is true
}
```

## API Details

### Endpoints Used

**Fetch Classes:**
```
GET /api/cult/classes/v2?productType=FITNESS
```

**Book Class:**
```
POST /api/cult/class/{classId}/book
```

### Required Headers

Automatically extracted from curl command:

- `apikey` - Public API key
- `appversion` - App version identifier
- `browsername` - Browser type
- `osname` - Operating system
- `timezone` - User timezone
- `Cookie` - Session cookies (at, st tokens)
- `user-agent` - Browser user agent
- `referer` - Referrer URL

## Security

### Safe Practices

- Always use GitHub Secrets for credentials (never commit them)
- GitHub Secrets are encrypted and never exposed in logs
- Rotate curl command when cookies expire (every 7-30 days)
- Keep your repository private if you prefer extra security
- Never commit `.env` files or credentials to git

### Why GitHub Secrets Are Safe

When you use GitHub Secrets:
- Values are encrypted at rest
- Never visible in workflow logs
- Only accessible during workflow execution
- Cannot be read by anyone (including you) after saving
- Not included in forked repositories

### What's In Your Repository

Your forked repository contains only:
- Source code (`index.js`, `config.js`)
- Workflow configuration (`.github/workflows/book-class.yml`)
- Documentation
- Dependencies list

Your credentials stay in Secrets (not in code).

### Token Expiration

Cult.fit session tokens typically expire after:
- 7-30 days of inactivity
- Password change
- Logout from all devices

When tokens expire, update CURL_COMMAND with fresh credentials.

## Limitations

- Single booking per day (by design)
- Targets a single fixed day offset from today (`BOOKING_DAYS_AHEAD`, default 4) per run — not per-run configurable without changing the env var
- Requires valid Cult.fit membership
- Dependent on Cult.fit API availability
- Tokens require periodic refresh
- Waitlist position determined by Cult.fit (first-come-first-served)
- No guarantee of confirmation from waitlist

## Contributing

Contributions welcome! Areas for improvement:

- Waitlist monitoring and auto-rebooking when spot opens
- Notification integrations (email, Slack, etc.)
- Advanced scheduling strategies
- Multiple booking preferences with priority

### Pull Request Process

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Test your changes locally (see Local Testing section)
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to your fork (`git push origin feature/amazing-feature`)
6. Open a Pull Request to this repository

## License

MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## FAQ

### Do I need to install anything on my computer?

No! Just fork the repository on GitHub and configure secrets. Everything runs on GitHub's servers.

### Is my Cult.fit login information safe?

Yes! GitHub Secrets are encrypted and never exposed. They're not visible in logs or accessible to anyone else.

### How much does this cost?

$0. GitHub Actions provides free compute time for public repositories, and more than enough for private repos too.

### Can I keep my forked repository private?

Yes! The automation works the same way with private repositories. Your credentials remain secure in either case.

### What if I want to change my preferences?

Just update the GitHub Secrets in your repository settings. Changes take effect on the next workflow run.

### How do I know if booking succeeded?

Check the Actions tab in your repository. Each run shows detailed logs including booking confirmation or errors.

### Do I need to update the curl command regularly?

Yes, session cookies expire after 7-30 days. When you see "Login Required" errors, update the `CURL_COMMAND` secret with a fresh curl from your browser.

### Can I book for multiple people?

No, one repository = one Cult.fit account. Fork additional copies for other accounts (use separate GitHub accounts).

### What time does the booking run?

By default the workflow starts at 9:54 PM IST and retries every 5 seconds through the 9:56-10:05 PM IST window until it succeeds. You can customize this via `WINDOW_START`/`WINDOW_END`/`RETRY_INTERVAL_SECONDS` in the workflow file (see [Customizing Schedule](#customizing-schedule)).

## Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Check existing issues for solutions
- Review troubleshooting and FAQ sections above

## Acknowledgments

Built for Cult.fit members who want automated booking. Not affiliated with or endorsed by Cult.fit.

## Inspired by:
https://medium.com/@nobrains/how-i-automated-booking-my-cult-classes-cbc568f05cc8
https://github.com/nobrains/CureFit
