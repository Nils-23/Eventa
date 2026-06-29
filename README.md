# Eventas Mobile App

Eventas is a location-based nightlife and event discovery platform.

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Development Server
```bash
npx expo start -c
```

## 📱 Running on Devices

### iOS
- **Simulator:** `npm run ios`
- **Physical Device:** `npm run ios -- --device` (Requires a Mac and your iPhone connected via USB)

### Android
- **Emulator:** `npm run android`
- **Physical Device:** `npm run android -- --device`

> [!IMPORTANT]
> To see the **App Icon** on a physical phone, you must run the `--device` command above to install a development build. The icon will not appear in the standard "Expo Go" app.

---

## 🛠 Useful Scripts

### 🎨 Update App Icons & Logo
If you replace `assets/EventasLogo.svg`, run this command to update the app icons and splash screen automatically:
```bash
node -e "const sharp = require('sharp'); const path = require('path'); const fs = require('fs'); const svgPath = './assets/EventasLogo.svg'; const icons = ['./assets/icon.png', './assets/adaptive-icon.png', './assets/splash-icon.png']; icons.forEach(icon => { sharp(svgPath).resize(1024, 1024).png().toFile(icon).then(() => console.log('Updated ' + icon)); });"
```

### 🔔 Notification Engine
Start the background service that handles location-based notifications and alerts:
```bash
npm run notify
```

### 📍 Seed Database (Venues)
Populate the Firebase database with default venue locations and data:
```bash
node scripts/seedVenues.js
```

### 🏃 Activity Simulation
Run the simulation engine to generate artificial activity and heat on the map:
```bash
node scripts/simulateActivity.js
```

### 🧹 Cleanup
Clean up old stories and temporary storage data:
```bash
node scripts/cleanupStorage.js
```

---

## 🏗 Project Structure
- `assets/`: App icons, logos, and static images.
- `components/`: Reusable UI components.
- `hooks/`: Custom React hooks for location, notifications, and data.
- `screens/`: Main application screens (Login, Map, Profile, etc.).
- `services/`: Firebase configuration and API logic.
- `scripts/`: Backend/Admin utility scripts.

---

## 🤖 AI Persona Message System (Local Testing)

The AI Persona system uses Claude (`claude-haiku-4-5`) to generate casual Sheng/English messages for venue chats. You can test and iterate on the prompt/generation quality locally without deploying to Firebase or using Firebase emulators.

### Environment Variables & Local Setup

To run this project locally, you must set up the following local configuration files (which are ignored by Git to prevent leaking credentials):

1. **`.env`** (in the root directory):
   ```env
   EXPO_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   EXPO_PUBLIC_FIREBASE_PROJECT_ID=your_project
   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   EXPO_PUBLIC_FIREBASE_APP_ID=your_app_id
   EXPO_PUBLIC_FIREBASE_DATABASE_URL=your_rtdb_url
   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your_ios_client_id
   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=your_android_client_id
   EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID=your_web_client_id
   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
   ANTHROPIC_API_KEY=your_anthropic_api_key
   ```
   *Note: `EXPO_PUBLIC_` variables are bundled with the Expo application. For local admin node scripts, load them using native Node.js support, e.g.: `node --env-file=.env scripts/fetch_existing_venues_images.js`.*

2. **`scripts/serviceAccountKey.json`**:
   This is the Firebase Admin SDK private service account credentials JSON. Download this file from the Firebase Console under **Project Settings > Service Accounts** and save it to the `scripts/` directory with the name `serviceAccountKey.json` to enable local backend/database seeding scripts to run.

### 1. Batch Test Harness (Tier 1)
Runs a batch of generations (default 100) rotating through mock dayparts, variants, and personas, and prints a final metrics report:
```bash
ANTHROPIC_API_KEY=your_key node scripts/harness.js
```
*Configurable parameters (model, temperature, sample size, and RNG seed for reproducibility) are exposed at the top of `scripts/harness.js`.*

### 2. Conversation Simulator (Tier 2)
Generates a continuous 20-message conversation thread in a single venue, feeding the message history back into the generation context to check the conversational flow:
```bash
ANTHROPIC_API_KEY=your_key node scripts/simulate.js
```

### Overriding the Daypart
You can force a specific daypart (e.g. `morning`, `afternoon`, `evening`, `night`) for all generated messages by setting `overrideDaypart` inside [fixtures.js](file:///Users/nilsakonkwa/Desktop/Eventa_Ant/scripts/fixtures.js):
```javascript
module.exports = {
  // ...
  overrideDaypart: 'morning' // Force morning time in the prompt
};
```

