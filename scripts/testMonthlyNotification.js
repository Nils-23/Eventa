const assert = require('assert');

// The date calculation and copy generation logic extracted from our function
function generateNotificationContent(testDate, nairobiTimezone = 'Africa/Nairobi') {
  // Get current day, month, and year in Africa/Nairobi timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: nairobiTimezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const formatted = formatter.format(testDate);
  const [yearStr, monthStr, dayStr] = formatted.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (day !== 1 && day !== 10 && day !== 20) {
    return { shouldRun: false, day };
  }

  let title = "";
  let body = "";

  if (day === 1) {
    title = "🏁 A New Month Begins!";
    body = "The slate has been cleaned! 🌟 Everyone starts fresh today. Time to get out there, check in, and start your journey to the top! 🚀";
  } else {
    // month is 1-indexed in our extracted variables, date constructor is 0-indexed.
    // passing year, month, 0 returns the last day of the 1-indexed month.
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysLeft = daysInMonth - day;

    title = "🏆 Legend Prize Countdown!";
    body = `Only ${daysLeft} days left to climb the leaderboard this month! Keep active, visit venues, and secure that Legend Prize! ✨`;
  }

  return {
    shouldRun: true,
    day,
    month,
    year,
    title,
    body
  };
}

function runTests() {
  console.log("=== Running Monthly Engagement Notification Tests ===");

  // 1. Test running on a non-notification day (e.g. June 15th)
  console.log("Test 1: Non-notification day (June 15th)...");
  const nonRunRes = generateNotificationContent(new Date('2026-06-15T09:00:00+03:00'));
  assert.strictEqual(nonRunRes.shouldRun, false);
  assert.strictEqual(nonRunRes.day, 15);
  console.log("Passed!");

  // 2. Test running on the 1st of June (Slate Cleaned)
  console.log("Test 2: June 1st...");
  const june1st = generateNotificationContent(new Date('2026-06-01T09:00:00+03:00'));
  assert.strictEqual(june1st.shouldRun, true);
  assert.strictEqual(june1st.day, 1);
  assert.strictEqual(june1st.title, "🏁 A New Month Begins!");
  assert.ok(june1st.body.includes("slate has been cleaned"));
  console.log("Passed!");

  // 3. Test running on the 10th of June (30-day month)
  console.log("Test 3: June 10th (30-day month, should have 20 days left)...");
  const june10 = generateNotificationContent(new Date('2026-06-10T09:00:00+03:00'));
  assert.strictEqual(june10.shouldRun, true);
  assert.strictEqual(june10.day, 10);
  assert.strictEqual(june10.title, "🏆 Legend Prize Countdown!");
  assert.ok(june10.body.includes("Only 20 days left"));
  console.log("Passed!");

  // 4. Test running on the 20th of July (31-day month)
  console.log("Test 4: July 20th (31-day month, should have 11 days left)...");
  const july20 = generateNotificationContent(new Date('2026-07-20T09:00:00+03:00'));
  assert.strictEqual(july20.shouldRun, true);
  assert.strictEqual(july20.day, 20);
  assert.ok(july20.body.includes("Only 11 days left"));
  console.log("Passed!");

  // 5. Test running on the 20th of February 2026 (non-leap year February, 28 days -> 8 days left)
  console.log("Test 5: Feb 20th 2026 (28-day month, should have 8 days left)...");
  const feb20 = generateNotificationContent(new Date('2026-02-20T09:00:00+03:00'));
  assert.strictEqual(feb20.shouldRun, true);
  assert.strictEqual(feb20.day, 20);
  assert.ok(feb20.body.includes("Only 8 days left"));
  console.log("Passed!");

  // 6. Test running on the 20th of February 2028 (leap year February, 29 days -> 9 days left)
  console.log("Test 6: Feb 20th 2028 (29-day month, should have 9 days left)...");
  const feb20Leap = generateNotificationContent(new Date('2028-02-20T09:00:00+03:00'));
  assert.strictEqual(feb20Leap.shouldRun, true);
  assert.strictEqual(feb20Leap.day, 20);
  assert.ok(feb20Leap.body.includes("Only 9 days left"));
  console.log("Passed!");

  console.log("=== ALL TESTS PASSED SUCCESSFULLY! ===");
}

runTests();
