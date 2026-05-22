# Firebase Integration

The application uses Firebase for database (Firestore) and authentication (Google Login).

## Configuration
- `firebase-applet-config.json`: Contains the Firebase configuration object (apiKey, authDomain, projectId, appId, firestoreDatabaseId).
- `firebase.ts`: Initializes the Firebase app and exports the `db` and `auth` instances.

## Security Rules
- `firestore.rules`: Defines the security rules for Firestore access.
- **Rules Generation**: Rules are generated to enforce least privilege, validate data types, and protect sensitive fields.
- **Deployment**: Rules are deployed to the user's Firebase project using the `deploy_firebase` tool.

## Error Handling
- All Firestore operations are wrapped in try-catch blocks.
- Errors are handled using a custom `handleFirestoreError` function which logs and throws a JSON string containing context about the error, including operation type and authentication info.
