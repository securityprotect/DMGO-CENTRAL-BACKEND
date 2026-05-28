# DMGO Central Backend

Centralized Next.js API server for the public frontend, admin frontend, authentication, database access, integrations, logging, and business logic.

## Responsibilities

- Public and admin REST APIs under `/api`
- Authentication and authorization
- MongoDB models and database connection management
- Admin-only API protection
- CORS, secure headers, and rate limiting middleware
- Email, Instagram, Razorpay, and service integrations

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Default backend URL: `http://localhost:4030`

Set `CORS_ORIGINS` to include the public and admin frontend origins.