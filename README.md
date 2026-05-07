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
