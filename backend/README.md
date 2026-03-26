# Backend Service — Platform Foundation

## Overview

This backend is built using NestJS with Fastify as the HTTP adapter, following a scalable and production-ready architecture.

It establishes the technical foundation for a multi-tenant system with secure request handling, modular structure, and strict validation rules.

---

## Tech Stack

* NestJS (Fastify adapter)
* TypeScript
* Fastify plugins:

  * Helmet (security headers)
  * CORS
  * Rate limiting
* Global validation using class-validator
* Environment configuration via @nestjs/config

---

## Project Structure

src/
├── common/        # Shared utilities (guards, filters, pipes)
├── config/        # Environment and configuration setup
├── modules/       # Feature-based modules
├── app.module.ts
├── main.ts

---

## Features Implemented (Milestone 1)

* Fastify-based NestJS bootstrap
* Security middleware:

  * Helmet
  * CORS
  * Rate limiting
* Global validation pipe:

  * whitelist enabled
  * forbid non-whitelisted fields
  * automatic transformation
* Environment-based configuration (.env)
* Clean modular and scalable folder structure

---

## Setup Instructions

### Navigate to backend directory

cd backend

### 1. Install dependencies

npm install

### 2. Configure environment

Create a `.env` file in the root directory based on `.env.example`

Example:

PORT=3000

### 3. Run the application

Development mode:

npm run start:dev

## API Base URL

http://localhost:3000/api

## Validation Rules

* Only allowed fields are accepted
* Unknown properties are rejected
* Payloads are automatically transformed into DTOs


## Security

The application includes:

* HTTP security headers via Helmet
* Controlled CORS configuration
* Rate limiting to prevent abuse

## Notes

* No usage of `any` types in the bootstrap process
* Security is enforced at the framework level
* Structure is prepared for future modules and scaling
* Designed to integrate with upcoming milestones (database, events, onboarding, etc.)
