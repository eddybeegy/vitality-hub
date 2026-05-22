# Security

The application prioritizes user data security and privacy.

## Authentication & Authorization
- **JWT Authentication**: Uses JSON Web Tokens (JWT) stored in HTTP-only cookies for secure session management.
- **Admin Roles**: Specific API endpoints (e.g., `/api/admin/users`) are restricted to users with the `admin` role.

## Data Security
- **SQLite Encryption**: User data is stored in a local SQLite database. Ensure the server environment is secure.
- **API Key Management**: API keys for external services (Withings, Hevy, AI providers) are stored securely on the backend and never exposed to the client-side.
- **Input Sanitization**: All user inputs are sanitized before being processed by the backend or used in database queries to prevent SQL injection and XSS attacks.
