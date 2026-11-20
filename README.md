# 💖 Dateza — Universal Real-Time Dating Application

Dateza is a modern, full-stack, real-time dating application featuring matching, instant messaging, discovery swipe decks, and a multi-user ephemeral stories system. It is built as a monorepo consisting of an **Express (Node.js) API server** backed by a **PostgreSQL database**, and a **universal React Native (Expo) client** that runs on iOS, Android, and Web browsers.

---

## 🚀 Key Features

* **⚡ Real-Time Chatting:** Powered by `Socket.io` WebSockets for instant message delivery, online indicators, and typing notifications.
* **🔥 Discovery Swipe Deck:** A swipe card deck with smooth gestures for swiping profiles (`like`, `pass`, `super-like`) and matching.
* **🌟 Multi-User Stories System:** Share photos or videos to your ephemeral story feed. Stories from other users are displayed in a clean, scrollable horizontal avatar bar.
* **📬 Icebreakers & Notifications:** Send custom introductory icebreaker messages on swipe to boost match rates, with native push-ready notification lists.
* **🎨 Premium Aesthetics:** Responsive glassmorphism layout, dark-mode color theme, and custom visual scrollbar integration.
* **🛠️ Profile setup wizard:** Interactive multi-step setup wizard to configure gender preferences, birthday, bio, height, and photo uploads.

---

## 📁 Repository Structure

```text
Dating App/
├── backend/                  # Node.js + Express + Socket.io Server
│   ├── db.js                 # PostgreSQL connection & pool config
│   ├── db_init.sql           # Database schema definition script
│   └── index.js              # Express app routing and server initialization
├── mobile/                   # Universal React Native (Expo Router) Client
│   ├── app/                  # Application screens (Tabs navigation)
│   ├── components/           # Reusable UI widgets (SwipeDeck, Buttons)
│   ├── lib/                  # State management store (Zustand) & hooks
│   └── global.css            # Stylesheets & Web scrollbar styles
├── package.json              # Monorepo root script forwarding configuration
└── powershell.bat            # Workspace terminal execution hook
```

---

## 🛠️ Technology Stack

| Component | Technology |
| :--- | :--- |
| **Client Core** | React Native (Expo Router v57.0) |
| **State Management** | Zustand (with local persistence) |
| **Styling** | Vanilla CSS, NativeWind (Tailwind CSS) |
| **Server Engine** | Node.js, Express, Socket.io |
| **Database** | PostgreSQL (Neon serverless cloud) |
| **Media Picker** | Expo Image Picker (camera roll integrations) |

---

## 💻 Installation & Quick Start

You can manage both the frontend and backend from the **root directory** using the configured workspace script shortcuts.

### Prerequisites
* [Node.js](https://nodejs.org/) (v18+)
* [Git](https://git-scm.com/)

---

### 1. Project Initialization

Clone this repository and install the dependencies for both modules:

```bash
# Install backend dependencies
cd backend
npm install

# Install mobile/web client dependencies
cd ../mobile
npm install
```

---

### 2. Running in Development

You can start the development servers directly from the **root directory**:

#### Start the Backend Server:
```bash
npm run dev
```
*This starts the Express server with `nodemon` on `http://localhost:5000` (auto-mapping to `10.0.2.2:5000` in Android emulators).*

#### Start the Expo Client:
```bash
npm run dev:mobile
```
*This opens the Expo builder on the web or console. Inside the console, you can select:*
* Press **`w`** to open and run the app in your desktop Web browser.
* Press **`a`** to load the app in your running Android Emulator.
* Press **`i`** to open the app on the iOS Simulator.

---

## 🔧 Environment Variables Configuration

Copy variables into local `.env` files in their respective folders:

### Backend Configuration (`backend/.env`)
```env
DATABASE_URL=postgresql://user:password@hostname/dbname?sslmode=require
PORT=5000
JWT_SECRET=your_super_secret_key_here

# Optional: one-tap Live Demo login (see "Live Demo" below). Off unless "true".
DEMO_LOGIN_ENABLED=true
# Optional: how long demo chat messages are kept (default 24)
DEMO_RETENTION_HOURS=24
# Optional: public URL of this backend, used for photos it hosts (e.g. https://api.example.com).
# If unset, it is worked out from each request.
PUBLIC_BASE_URL=
```

### Mobile App Configuration (`mobile/.env`)
```env
EXPO_PUBLIC_BACKEND_URL=http://localhost:5000
```
*(On Android emulators, this is automatically redirected to `http://10.0.2.2:5000`).*

---

## 📱 Live Demo (two devices, no sign-up)

With `DEMO_LOGIN_ENABLED=true` on the backend, the welcome screen shows **Live Demo · Chat on 2 devices**:

1. On device 1, tap **Live Demo** and pick **Alex**.
2. On device 2, tap **Live Demo** and pick **Elena**.
3. Both land in the same chat and can message each other in real time.

Alex and Elena are shared, pre-matched accounts created automatically on first use. They can't be logged into with a password, they never appear to real users in discovery, and their chat is trimmed to the last `DEMO_RETENTION_HOURS`. Everyone using the demo sees the same conversation, so turn it off (`DEMO_LOGIN_ENABLED` unset) once real users join.

Both devices must reach the backend: deploy it, or on the same Wi-Fi set `EXPO_PUBLIC_BACKEND_URL` to your computer's LAN address (for example `http://192.168.1.15:5000`) and allow the port through your firewall.

The **Offline demo** link on the welcome screen needs no server, but only works on one device with simulated replies.

---

## 📦 Deployment Guides

### ☁️ One-click on Render (backend + web app)
The repo includes a [`render.yaml`](render.yaml) Blueprint that creates the API (`dateza-api`) and the web app (`dateza-web`). The database is an external [Neon](https://neon.tech) Postgres.

1. Create a free Neon project and copy its connection string.
2. Push this repo to GitHub, then in Render choose **New → Blueprint** and pick the repo.
3. When prompted, set `DATABASE_URL` (Neon string), `EXPO_PUBLIC_BACKEND_URL` (e.g. `https://dateza-api.onrender.com`), and optionally `CORS_ORIGIN` (e.g. `https://dateza-web.onrender.com`).
4. After the first deploy, check the real URLs Render assigned. If they differ, update those two variables and redeploy the web app.

Free Render web services sleep after ~15 minutes idle, so the first request after a pause is slow.

### 🌐 Deploying the Backend (API Server)
You can deploy the backend to host platforms like **Render**, **Railway**, or **Fly.io**:
1. Connect your Git repository.
2. Set the **Root Directory** to `backend`.
3. Set the **Build Command** to `npm install` and **Start Command** to `node index.js`.
4. Add your database connection string and environment variables in the host provider panel.

### 🖥️ Deploying the Web Client
Export the static bundle and host it on **Vercel** or **Netlify**:
1. Change `EXPO_PUBLIC_BACKEND_URL` in `mobile/.env` to point to your live backend endpoint.
2. Build the static bundle inside the `mobile` folder:
   ```bash
   npx expo export --platform web
   ```
3. Deploy the resulting `dist` folder to Vercel:
   ```bash
   npx vercel
   ```

### 📱 Building App Packages (Android / iOS)
Compile executable packages using **EAS (Expo Application Services)**:
```bash
# Login to your Expo developer account
eas login

# Initialize configuration
eas project:init

# Build Android APK (preview release)
eas build --platform android --profile preview

# Build iOS IPA package
eas build --platform ios
```
