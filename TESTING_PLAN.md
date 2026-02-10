# TimeCapsule Diary — Testing Plan

Run through each section in order. You need **two iPhones** (or one iPhone + TestFlight on a partner's phone) and **two separate email accounts**.

---

## 1. Authentication

### Sign Up (Account A — your phone)

- [ ] Open app → should see Sign In screen
- [ ] Tap "Don't have an account? Sign Up"
- [ ] Enter display name, email, password → tap Sign Up
- [ ] Should see success message (or auto-redirect to Home)
- [ ] **Verify in Supabase dashboard**: `profiles` table has a row with your user ID and display name

### Sign Up (Account B — partner's phone)

- [ ] Repeat the above on the second device with a different email
- [ ] **Verify**: second row in `profiles` table

### Sign Out / Sign In

- [ ] Tap Settings tab → Sign Out → confirm
- [ ] Should redirect to Sign In screen
- [ ] Sign back in with email + password → should land on Home tab
- [ ] Profile name should show in the Home greeting

### Edge cases

- [ ] Try signing up with an already-used email → should show error
- [ ] Try signing in with wrong password → should show error
- [ ] Try submitting empty fields → should show validation error

---

## 2. Partner Pairing

### Create Couple (Account A)

- [ ] Go to Settings tab → should see "Create a Couple" and "Join a couple" options
- [ ] Tap "Create a Couple" → should show an 8-character invite code
- [ ] Tap "Share Code" → iOS share sheet should appear
- [ ] **Verify in Supabase**: `couples` table has a row with `partner_1_id` = your ID, `partner_2_id` = null

### Join Couple (Account B)

- [ ] On Account B's phone, go to Settings tab
- [ ] Enter the invite code from Account A → tap "Join with Code"
- [ ] Should see success message, then "Connected" with partner name
- [ ] **Verify in Supabase**: `couples` row now has `partner_2_id` filled in

### Anniversary Date

- [ ] Either account: tap "Set Anniversary Date" → pick a date → save
- [ ] Date should display on the Settings screen
- [ ] Home tab should show countdown (days until anniversary)
- [ ] **Verify in Supabase**: `couples.anniversary_date` is set

### Edge cases

- [ ] Try joining with an invalid code → should show error
- [ ] Try joining when already in a couple → should not show join UI
- [ ] Try creating a couple when already in one → should not show create UI

---

## 3. Diary Entries

### Create Entry (Account A)

- [ ] Tap "Write a New Entry" on Home, or Diary tab → tap + FAB
- [ ] Enter a title and body text
- [ ] Select a mood chip (e.g. "Happy")
- [ ] Tap location icon → allow location permission → location name should appear
- [ ] Tap "Publish"
- [ ] Should navigate back to entry list, new entry visible
- [ ] **Verify in Supabase**: `entries` table has a row with `is_draft = false`, `word_count > 0`, `location_lat` filled in

### Create Draft (Account A)

- [ ] Create another entry but tap "Save Draft" instead of Publish
- [ ] Entry list should show it with a "Draft" badge
- [ ] **Verify**: `is_draft = true` in the database

### View / Edit Entry

- [ ] Tap an entry in the list → should see full detail view
- [ ] Tap "Edit" → change the title → tap "Save Changes"
- [ ] Title should update
- [ ] Tap "Edit" again → tap "Cancel" → changes should revert

### Publish a Draft

- [ ] Open a draft entry → tap "Publish Entry"
- [ ] Draft badge should disappear
- [ ] **Verify**: `is_draft` flipped to `false`

### Delete Entry

- [ ] Open an entry → tap "Delete" → confirm
- [ ] Should navigate back, entry gone from list
- [ ] **Verify**: row deleted from `entries` table

### Create Entries (Account B)

- [ ] On Account B's phone, create 2-3 published entries with different moods, locations, dates
- [ ] This gives us data for the reveal later

### Edge cases

- [ ] Try publishing with empty title + empty body → should show error
- [ ] Add an image via camera or library → should show "[Image attached]" placeholder

---

## 4. Home Dashboard

### Stats Display

- [ ] Account A Home tab should show:
  - [ ] Greeting with your display name
  - [ ] "Paired with [partner name]"
  - [ ] Anniversary countdown (if date is set)
  - [ ] Your entry count and word count
  - [ ] Partner's entry count (number only, no content) — e.g. "3 entries waiting for you"

### Partner Privacy

- [ ] Account A should NOT be able to see any of Account B's entry titles, content, or details
- [ ] Only the count should be visible
- [ ] **Verify by querying Supabase as Account A**: `SELECT * FROM entries WHERE author_id = [B's ID]` should return empty (RLS blocks it)

---

## 5. Anniversary Reveal

> **Setup**: Set the anniversary date to **today's date** so the reveal triggers.

### Trigger Reveal (either account)

- [ ] Set anniversary date to today in Settings
- [ ] Home tab should show "Open Your TimeCapsule!" button
- [ ] Reveal tab should show the gift icon and "Your TimeCapsule is ready!" screen
- [ ] Tap "Open TimeCapsule"

### Stats Slides (swipe through all 13 + outro)

- [ ] **Slide 1** — Total entries together: shows combined count
- [ ] **Slide 2** — Entry count showdown: bars with names, crown on winner
- [ ] **Slide 3** — Total words: number + book comparison
- [ ] **Slide 4** — Word count showdown: bars per partner
- [ ] **Slide 5** — Night Owl vs Early Bird: time-of-day labels
- [ ] **Slide 6** — Most active month: month name + count
- [ ] **Slide 7** — Longest entry: word count, date, author
- [ ] **Slide 8** — Longest streak: days per partner
- [ ] **Slide 9** — Photos & Videos: counts (may be 0)
- [ ] **Slide 10** — Top moods: emoji per partner
- [ ] **Slide 11** — First & last entry: dates with timeline
- [ ] **Slide 12** — Day of week favorites: day names per partner
- [ ] **Slide 13** — Love Map: map with colored pins (if entries had locations)
- [ ] **Outro** — "Read their entries" button

### Browse Revealed Entries

- [ ] Tap "Read Their Entries" on the outro slide
- [ ] Should show a merged timeline of ALL entries from both partners
- [ ] Each entry card shows author name, colored left border (partner 1 vs 2), date, mood, location
- [ ] Can scroll through and read partner's entries for the first time

### Verify State

- [ ] **Supabase**: `couples.is_revealed = true`, `last_reveal_year = [current year]`
- [ ] Account A can now query Account B's entries (RLS unlocked)

---

## 6. Push Notifications (requires physical devices + EAS build)

> Skip if testing in Expo Go — push tokens require a dev build.

- [ ] Both accounts: app requests notification permission on first launch
- [ ] **Verify**: `profiles.expo_push_token` is populated for both accounts
- [ ] Account A publishes a new entry → Account B should receive a push notification
- [ ] Notification title: "New Diary Entry!"
- [ ] Notification body: "[Account A's name] just wrote something new"
- [ ] Notification does NOT contain any entry content (privacy preserved)
- [ ] Tapping notification opens the app to Home (not to the entry)

---

## 7. Edge Cases & Robustness

- [ ] Kill and reopen app → session should persist (auto sign-in)
- [ ] Pull-to-refresh on entry list → should reload entries
- [ ] Rapidly tap "Create a Couple" multiple times → should not create duplicates
- [ ] Sign out on one device → other device should still work independently
- [ ] Set anniversary to a future date → Reveal tab should show locked state
- [ ] Change anniversary date after reveal → should still show revealed state for current year
