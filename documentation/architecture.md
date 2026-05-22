# Architecture

The application follows a full-stack architecture using a Node.js/Express backend and a React/Vite frontend.

## Frontend
- **Framework**: React 18+ with Vite.
- **State Management**: Zustand for managing application state (settings, health data, AI insights).
- **Styling**: Tailwind CSS.
- **Visualization**: Recharts for health charts.
- **Animations**: Framer Motion.

## Backend
- **Framework**: Express.js.
- **Database**: SQLite (via `better-sqlite3`) for storing user data, meal items, metrics, and chat history.
- **API**: RESTful API endpoints for data fetching, settings management, and AI interaction.

## Database Schema
- **users**: Stores user profile, settings, AI configuration, and authentication info.
- **meal_items**: Stores nutritional data synced from modules.
- **metrics**: Stores health metrics (weight, sleep, etc.).
- **ai_insights**: Stores AI-generated nutrition and workout insights.
- **chat_history**: Stores chat conversations with the AI assistant.

## Caching Layer
- The application implements an in-memory caching layer using `node-cache` to store frequently accessed data, such as aggregated health metrics and summary data. This reduces database load and improves dashboard responsiveness.
- Caching is configured with a Time-To-Live (TTL) of 5 minutes.

## Background Job Processing
- The application uses an in-memory task queue to handle heavy data synchronization tasks.
- This ensures that API requests for data synchronization return immediately (202 Accepted), keeping the UI responsive while tasks are processed asynchronously in the background.
