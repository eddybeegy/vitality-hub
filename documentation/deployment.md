# Deployment

The application is designed to be deployed in a containerized environment (e.g., Google Cloud Run).

## Build Process
- The application uses `npm run build` to compile the frontend and prepare the backend for production.
- Production start command: `node server.ts`.

## Environment Variables
Ensure the following environment variables are set in the production environment:
- `JWT_SECRET`: Secret key for signing JWTs.
- `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET`: Credentials for Withings OAuth.
- `HEVY_API_KEY`: API key for Hevy integration.
- `NODE_ENV`: Set to `production`.
- `GEMINI_API_KEY`: API key for Gemini API.
