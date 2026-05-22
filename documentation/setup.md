# Setup & Installation

## Prerequisites
- Node.js (v18+)
- npm (v10+)

## Installation
1. Clone the repository.
2. Install dependencies: `npm install`.
3. Set up environment variables: Create a `.env` file based on `.env.example`.
4. Start the development server: `npm run dev`.

## Environment Variables
- `JWT_SECRET`: Used for signing authentication tokens.
- `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET`: Used for Withings OAuth integration.
- `HEVY_API_KEY`: Used for Hevy integration.
- `GEMINI_API_KEY`: Used for AI functionalities.
- `NODE_ENV`: Used to determine production vs. development environment.
