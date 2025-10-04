# 2025-01-06 - React Web Frontend

## Summary
Created a modern React web frontend for the Spotify playlist management system that connects to DynamoDB and is deployable via Lambda. The frontend uses Bun as the runtime and build tool, providing a responsive dashboard interface for managing playlists and viewing action history.

## Changes Made

### Frontend Stack
- **Runtime & Build**: Bun for package management and building
- **Framework**: React 19 with TypeScript
- **Bundler**: Vite for fast development and optimized production builds
- **Styling**: Tailwind CSS for responsive design
- **State Management**: React Query for server state and caching
- **Routing**: React Router for client-side navigation

### Features Implemented

1. **Dashboard** (`/`)
   - User information display
   - Playlist overview (Inbox, Current, Starred track counts)
   - Quick action buttons (Process Playback, Archive)
   - Configuration settings view

2. **Action History** (`/history`)
   - Table view of recent actions with timestamps
   - Undo capability for promote/demote actions
   - Status indicators (completed/undone)
   - Track details for relevant actions

3. **Playlist Viewer** (`/playlists`)
   - Grid view of all playlists
   - Search functionality
   - Sort by name or track count
   - Direct links to open in Spotify

4. **Track Controls** (in header)
   - Shows currently playing track
   - Quick promote/demote buttons
   - Real-time updates every 5 seconds

### API Integration

Created new API endpoints in `src/web-api.ts`:
- `GET /api/dashboard` - Combined dashboard data
- `GET /api/actions/recent` - Recent action history
- `GET /api/playlists` - All user playlists
- `GET /api/tracks/current` - Currently playing track
- `POST /api/actions/{action}` - Trigger actions (promote, demote, archive, etc.)

### Lambda Updates

Modified `src/index.ts` to handle:
- Static file serving from `web/dist`
- API routing to web API handler
- Proper MIME types for assets
- React Router support (serving index.html for client routes)

### Deployment Updates

Updated `scripts/publish.rb` to:
1. Build React app with Bun before deployment
2. Include built web assets in Lambda package
3. Exclude source files and node_modules from web directory

### File Structure

```
web/
├── package.json         # Bun package configuration
├── vite.config.ts      # Vite bundler configuration
├── tailwind.config.js  # Tailwind CSS configuration
├── index.html          # HTML entry point
├── src/
│   ├── main.tsx        # React app entry
│   ├── App.tsx         # Main app component with routing
│   ├── index.css       # Tailwind imports
│   ├── api/
│   │   └── client.ts   # API client with typed methods
│   ├── components/
│   │   ├── Dashboard.tsx      # Dashboard view
│   │   ├── ActionHistory.tsx  # Action history table
│   │   ├── TrackControls.tsx  # Quick track controls
│   │   └── PlaylistViewer.tsx # Playlist browser
│   └── hooks/
│       └── useSpotifyData.ts  # Custom React Query hooks
```

## Usage

### Development
```bash
cd web && bun run dev  # Start Vite dev server on port 3000
```

### Production Build
```bash
cd web && bun run build  # Build optimized production bundle
```

### Deployment
```bash
ruby scripts/publish.rb  # Build and deploy to AWS Lambda
```

## Notes

- The frontend is designed for personal use with hardcoded user "koalemos"
- CORS is configured to allow API access from any origin
- React Query provides automatic background refetching for real-time updates
- The system uses optimistic updates for better UX when triggering actions