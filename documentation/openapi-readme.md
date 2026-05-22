# OpenAPI Reference for Vitality Hub

This README explains how to use the Vitality Hub OpenAPI contract for tooling, validation, and client generation.

## Files

- `documentation/openapi.yaml` — primary OpenAPI contract in YAML format
- `documentation/openapi.json` — identical contract in JSON format
- `documentation/api-openapi.md` — human-readable API reference aligned with the OpenAPI contract

## Validate the contract

Install a validator and run it against the YAML file:

```bash
npm install -g @apidevtools/swagger-cli
swagger-cli validate documentation/openapi.yaml
```

If the contract is valid, the validator will complete without errors.

## Browse the API interactively

### Swagger Editor

Open `documentation/openapi.yaml` in Swagger Editor to explore endpoints, models, and request/response shapes.

### Swagger UI

Point Swagger UI at the YAML file or host it behind a local or static server.

## Generate client SDKs

Use OpenAPI Generator to create a client in your preferred language.

Example for TypeScript Axios:

```bash
npm install -g @openapitools/openapi-generator-cli
openapi-generator-cli generate -i documentation/openapi.yaml -g typescript-axios -o generated/api-client
```

Example for Python:

```bash
openapi-generator-cli generate -i documentation/openapi.yaml -g python -o generated/python-client
```

## Notes

- The contract is versioned as OpenAPI 3.0.3.
- Authentication is via the `auth_token` cookie, as used by the frontend.
- Admin-only endpoints require the authenticated user to have `role: admin`.
- Use the YAML file for most tooling; the JSON file is available for systems that require it.
