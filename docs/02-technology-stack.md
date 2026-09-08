# 1on1 --- Technology Stack & Engineering Plan

## 1. Current Technology Stack

### Frontend

-   React
-   TypeScript
-   HTML
-   CSS
-   anime.js
-   D3.js

### Backend

-   Node.js
-   Express
-   TypeScript

### Database & Hosting

-   **PostgreSQL 16/17 on AWS Lightsail VPS** (Mumbai, `ap-south-1`)
-   **Frontend Hosting:** Vercel (Hobby Tier, $0/mo)

> **DECIDED 2026-09-08 — this line is canonical.** (Supersedes the 2026-09-06 RDS proposal).
>
> **The choice: PostgreSQL on AWS Lightsail VPS ($5.00/mo).** Reasoning:
>
> -   The data is **join-heavy** — follows, session offerings, availability,
>     bookings and payments are relational. The engine is strictly PostgreSQL.
> -   **Cost:** Flat $5.00/mo (~₹470 INR/mo) with included static IPv4 and SSD,
>     guaranteeing spend stays well below Teja's ₹800/mo budget alert.
> -   **Co-location:** Express backend and PostgreSQL run on the same VPS,
>     yielding sub-millisecond query latency over `localhost` and zero open DB ports
>     exposed to the public internet.
> -   **Media storage:** Binary images and videos are stored in **AWS S3** via
>     presigned upload URLs; only URLs/metadata reside in PostgreSQL.
> -   **Frontend integration:** Vercel proxies `/api/*` requests to the Lightsail
>     public IP via `frontend/vercel.json` rewrites.
>
> Full ADR: `docs/decisions/2026-09-08-hosting-settled-lightsail-vps-and-vercel.md`
> Schema design: `docs/architecture/01-data-model.md`

There is no MongoDB in this project. The stack is Node.js end to end — no Java,
no Spring Boot, no JVM component of any kind.

### Realtime

-   Socket.IO
-   WebRTC

### AI

-   Gemini API
-   Agent/tool calling
-   Guardrails
-   Prompt engineering
-   AI moderation
-   AI meeting notes

### Version Control

-   Git
-   GitHub

###  hosting target

-   Google Cloud Platform

### Later infrastructure

-   Redis
-   RAG
-   Conversation memory
-   Background job processing
-   Caching
-   Presence scaling

Docker is intentionally excluded from the current plan.

------------------------------------------------------------------------

## 2. Programming Languages

Required:

-   TypeScript
-   JavaScript concepts
-   HTML
-   CSS
-   SQL and query concepts for RDS PostgreSQL

The application does not require multiple backend programming languages.

TypeScript should be preferred for both frontend and backend to reduce
context switching and improve type safety.

As of 2026-09-05 the frontend is being ported from plain `.jsx` to TypeScript
(React + Vite + TypeScript), closing the long-standing gap between this document
and the code on disk. The backend remains Node.js + Express (ESM).

------------------------------------------------------------------------

## 3. Authentication

V1 authentication should support:

-   Email
-   Password
-   JWT
-   Access token
-   Refresh token
-   HTTP-only cookies
-   Forgot password
-   Password reset

There is **no phone-number authentication**.

Authentication identity is based on email + password.

Google authentication/OAuth can be included as an additional login
option if required, but email/password remains the core credential flow.

Clerk is a future option and should not be introduced into the current
implementation.

The canonical auth endpoints are `POST /api/auth/register`,
`POST /api/auth/login` and `POST /api/auth/refresh`. Authentication is
implemented in Express with `bcrypt` hashing and `jsonwebtoken` — there is no
Spring Security or any other non-Node auth stack in this project.

**These are the intended contract, not shipped behaviour.** As of 2026-09-05 the
backend implements exactly one route, `GET /api/health`. None of the auth
endpoints exist yet. The frontend's `frontend/src/lib/api.ts` already calls them
and degrades through its network-error path, which is deliberate — the UI landed
first.

Google OAuth stays optional and additive; it never replaces email + password.
The frontend currently points it at `GET /api/auth/google`, an Express-shaped
path chosen because the Spring convention `/oauth2/authorization/google` does
not exist here and there is no Spring in this project.

> **TODO:** `/api/auth/google` is a placeholder — `frontend/src/lib/api.ts`
> carries the matching TODO. Settle the real Express OAuth route (and the
> callback path) when the backend auth layer is actually built.

------------------------------------------------------------------------

## 4. JWT Model

Recommended flow:

**Login**

User submits email/password.

Backend:

1.  Find user.
2.  Compare password hash.
3.  Generate access token.
4.  Generate refresh token.
5.  Set secure HTTP-only refresh cookie.
6.  Return authenticated application state.

Access token should be short-lived.

Refresh token should be longer-lived.

Refresh token rotation and server-side invalidation can be implemented
when the auth layer is hardened.

------------------------------------------------------------------------

## 5. Password Security

Passwords should never be stored directly.

we use hashing strong algo which is 

-   bcrypt

The database stores only the password hash.

------------------------------------------------------------------------

## 6. Authentication Provider Roadmap

Current:

**Custom JWT authentication**

Later:

**Clerk**

Clerk should only be introduced when there is a clear benefit in
reducing authentication infrastructure complexity.

Do not mix Clerk and custom JWT unnecessarily in V1.

------------------------------------------------------------------------

## 7. REST API

Express provides REST APIs for:

-   Authentication
-   Users
-   Profiles
-   Follow system
-   Posts
-   Comments
-   Search
-   Sessions
-   Availability
-   Reviews
-   Notifications
-   Certifications
-   Achievements
-   AI tools

The frontend should not directly access the database. All data access goes
through the Express REST API.

------------------------------------------------------------------------

## 8. Socket.IO Responsibilities

Socket.IO should handle realtime events.

### Messaging

-   1:1 messages
-   Group/session chat
-   Typing indicators
-   Delivery status
-   Seen status

### Presence

-   Online
-   Offline
-   Last seen

### Notifications

Realtime notification delivery.

### Meeting collaboration

-   Whiteboard operations
-   Reactions
-   Raise hand
-   Participant state
-   Session events

### WebRTC signaling

Socket.IO exchanges:

-   SDP offers
-   SDP answers
-   ICE candidates

Socket.IO does NOT transmit the actual video/audio stream.

WebRTC handles media transmission.

------------------------------------------------------------------------

## 9. Messaging Model

A message lifecycle:

**Sent → Delivered → Seen**

The actual message should be persisted in RDS PostgreSQL.

Temporary realtime states such as typing indicators should not be
persisted as normal messages.

A conversation can be:

-   1:1
-   Group/session-based

Recommended collections:

-   Conversation
-   Message

> **TODO:** "collections" here is MongoDB vocabulary that predates the AWS
> migration — same caveat as §16. Read it as "two entities", and re-derive the
> actual storage shape once the AWS database service is chosen.

------------------------------------------------------------------------

## 10. Online/Offline Presence

Socket.IO connection state provides initial presence.

For a single backend instance:

The database may not be required for transient online status.

Later, when multiple backend instances exist, Redis should manage shared
presence.

Future architecture:

**Client → Socket.IO instance → Redis adapter → other Socket.IO
instances**

------------------------------------------------------------------------

## 11. WebRTC

WebRTC handles:

-   Audio
-   Video
-   Screen sharing
-   Group session media

Socket.IO acts as the signaling mechanism.

Architecture:

**Peer A → Socket.IO signaling → Peer B**

After signaling:

**Peer A ↔ WebRTC ↔ Peer B**

For group calls, a pure peer-to-peer mesh can become inefficient as
participant count increases.

The future scalable architecture can introduce an SFU such as
mediasoup/LiveKit/Janus if needed.

Do not introduce an SFU into the prototype unless group-session scale
requires it.

------------------------------------------------------------------------

## 12. Meeting Features

V1 meeting:

-   Video
-   Audio
-   Camera toggle
-   Mic toggle
-   Screen sharing
-   Participant list
-   Fullscreen
-   Session chat
-   Reactions
-   Raise hand
-   Whiteboard
-   Shared notes
-   Code snippets
-   Polls
-   Q&A
-   Recording
-   AI transcript
-   AI summary
-   Action items

No file sharing.

------------------------------------------------------------------------

## 13. Whiteboard Technology

V1 can use a browser canvas-based whiteboard.

Realtime synchronization can use Socket.IO.

A whiteboard operation can be represented as an event:

-   create object
-   move object
-   resize object
-   delete object
-   draw stroke
-   edit text

For high-concurrency collaboration, a CRDT architecture can be
introduced later.

------------------------------------------------------------------------


## 15. Recording

Recording architecture should be treated separately from WebRTC
signaling.

Browser-side recording can use MediaRecorder for an initial
implementation.

Future cloud architecture can include:

-   Object storage
-   Transcoding
-   Recording metadata
-   Access permissions
-   Retention policies

GCP storage is a future deployment consideration.

------------------------------------------------------------------------

## 16. Data Model

> **RESOLVED 2026-09-06 — see `docs/architecture/01-data-model.md`.**
>
> §16–§22 were written against MongoDB and are still phrased in document-database
> terms ("collections", embedded documents). The database is now **RDS
> PostgreSQL** (§1), and the real relational schema — tables, columns, keys,
> constraints, indexes and the booking state machine — lives in
> **`docs/architecture/01-data-model.md`**. That file is the schema's single
> source of truth.
>
> These sections are **deliberately left as-is rather than rewritten**, so that
> the schema is described in exactly one place. Restating table definitions here
> would create a second copy that drifts out of date the first time a column
> changes. Read §16–§22 as *product intent* — which entities exist and how they
> relate — and the data-model doc as *the schema*. Where they disagree, the
> data-model doc wins.

Core collections:

-   User
-   Post
-   Comment
-   Follow
-   Conversation
-   Message
-   Notification
-   Session
-   SessionParticipant
-   Availability
-   Review
-   Certification
-   CertificateVerification
-   Submission
-   Badge
-   Report
-   MeetingTranscript
-   MeetingNotes

Additional collections can be introduced only when the data model
actually requires them.

------------------------------------------------------------------------

## 17. User Collection

The User document should contain stable profile data:

-   Name
-   Email
-   Password hash
-   Avatar
-   Cover
-   Bio
-   Skills
-   Experience
-   Education
-   Profile metadata
-   Provider/mentor status
-   Verification status
-   CreatedAt
-   UpdatedAt

Do not store unlimited followers, following IDs, messages or posts
directly inside User.

Those should be separate collections.

------------------------------------------------------------------------

## 18. Follow Collection

A follow relationship:

-   followerId
-   followingId
-   createdAt

Unique compound index:

`followerId + followingId`

Actions:

-   Follow
-   Unfollow
-   Remove follower

Block relationships should be represented separately or through a
dedicated relationship state.

------------------------------------------------------------------------

## 19. Session Collection

Important fields:

-   providerId
-   title
-   description
-   type
-   duration
-   price
-   currency
-   capacity
-   availability configuration
-   status
-   cancellation policy
-   createdAt

Booking/session instances should be separate from reusable session
offerings if the product supports recurring availability.

------------------------------------------------------------------------

## 20. Session State Machine

Valid states:

`REQUESTED`

→ `ACCEPTED`

→ `IN_PROGRESS`

→ `COMPLETED`

Alternative paths:

`REQUESTED → REJECTED`

`ACCEPTED → RESCHEDULED`

`ACCEPTED → CANCELLED`

`ACCEPTED → NO_SHOW`

The backend must enforce legal state transitions.

------------------------------------------------------------------------

## 21. Mock Payment Model

No real payment provider.

The system should simulate:

-   Payment creation
-   Payment success
-   Payment failure
-   Refund
-   Cancellation fee

This lets the UI demonstrate paid-session behavior without handling real
money.

------------------------------------------------------------------------

## 22. Cancellation Engine

The backend calculates:

`timeUntilSession`

Then applies the configured cancellation rule.

Output:

-   Original amount
-   Fee
-   Refund
-   Rule

The frontend should display the backend-calculated result rather than
calculate it independently.

------------------------------------------------------------------------

## 23. AI Architecture

Gemini should sit behind a server-side AI service.

Frontend:

**React → Express AI endpoint → Gemini**

Never expose secret Gemini API keys in browser code.

------------------------------------------------------------------------

## 24. Agent Tool Architecture

Tools are backend functions.

Examples:

-   searchUsers()
-   searchPosts()
-   searchSessions()
-   getAvailability()
-   requestSession()
-   cancelSession()
-   rescheduleSession()
-   followUser()
-   unfollowUser()
-   sendMessage()
-   getNotifications()

Gemini decides which tool is relevant.

Express validates authorization.

The tool performs the action.

The database stores the result.

------------------------------------------------------------------------

## 25. AI Guardrails

The agent requires:

-   System prompt
-   Tool schemas
-   Input validation
-   Output validation
-   Authorization
-   Confirmation gates
-   Rate limits
-   Audit logging
-   Prompt-injection defenses

The agent must not bypass backend authorization.

------------------------------------------------------------------------

## 26. AI Moderation

AI moderation can run before publication or after content creation
depending on latency requirements.

Content candidates:

-   Posts
-   Comments
-   Messages where policy requires it
-   Session descriptions
-   Profile content

Moderation output should be structured:

-   category
-   risk level
-   action
-   confidence
-   reason

Do not allow arbitrary model text to directly control database
operations.

------------------------------------------------------------------------

## 27. AI Meeting Intelligence

Meeting pipeline:

**Meeting → transcript → Gemini → structured JSON → RDS PostgreSQL**

Store:

-   transcript metadata
-   summary
-   key points
-   decisions
-   action items
-   topics

Avoid storing raw audio indefinitely unless there is a clear retention
policy.

------------------------------------------------------------------------

## 28. AI Memory

Conversation memory is planned, not V1.

Later memory can include:

-   User preferences
-   Previous AI conversations
-   Relevant session history
-   Repeated tasks
-   User profile context

Sensitive data should not automatically become permanent memory.

------------------------------------------------------------------------

## 29. RAG

RAG is planned for later.

Potential sources:

-   Platform documentation
-   Feature documentation
-   Cancellation policies
-   User-approved profile information
-   Session information
-   AI assistant knowledge

RAG should not be introduced just to make the project sound more
advanced.

------------------------------------------------------------------------

## 30. Redis

Redis is planned for later.

Potential uses:

-   Cache
-   Socket.IO adapter
-   Presence
-   Rate limiting
-   Session reminders
-   Background jobs
-   AI task queues
-   Temporary state

RDS PostgreSQL remains the primary database.

------------------------------------------------------------------------

## 31. Background Jobs

Later, Redis + BullMQ can process:

-   Session reminders
-   AI meeting processing
-   Email notifications
-   Recording processing
-   Moderation queues
-   Certificate processing

Do not introduce a queue until synchronous processing becomes a problem.

------------------------------------------------------------------------

## 32. Blockchain Certification

Certification verification is part of the current product plan.

Flow:

**Certificate data → canonical representation → SHA-256 hash →
certificate verification ID → verification record → blockchain hash
anchoring**

Sensitive certificate data should remain off-chain.

Only the cryptographic fingerprint or appropriate proof should be
anchored.

------------------------------------------------------------------------

## 33. GCP Hosting Roadmap

Initial prototype can run on Render.

Later target:

-   GCP application hosting
-   GCP storage for recordings/assets
-   Gemini API / Google Cloud integration
-   RDS PostgreSQL remains an external managed database unless
    a future architecture decision changes it
-   Redis as managed/hosted infrastructure later

> **TODO:** the database now lives on AWS while application hosting still targets
> GCP. Confirm whether that cross-cloud split is intended before committing to
> either, and record the exact AWS database service alongside it.

Do not move to GCP prematurely just because it is the eventual hosting
target.

------------------------------------------------------------------------

## 34. No Docker in Current Plan

Docker is intentionally excluded.

The current objective is rapid development and deployment using the
existing runtime.

Docker can be reconsidered later if:

-   deployment complexity increases
-   multiple services need reproducible environments
-   workers are introduced
-   infrastructure becomes more complex

------------------------------------------------------------------------

## 35. Testing Strategy

V1 should include practical tests around the most dangerous logic:

-   Auth
-   JWT validation
-   Follow/unfollow
-   Session state transitions
-   Availability conflicts
-   Cancellation calculations
-   Mock refunds
-   AI tool authorization

Realtime/WebRTC should be tested manually and with targeted integration
tests.

------------------------------------------------------------------------

## 36. Development Priority

Priority 1:

-   Authentication
-   Profiles
-   Follow
-   Posts/feed
-   Search

Priority 2:

-   Session creation
-   Availability
-   Session request
-   Scheduling
-   Mock payments
-   Cancellation

Priority 3:

-   WebRTC
-   Group sessions
-   Socket.IO chat
-   Whiteboard
-   Screen sharing

Priority 4:

-   AI meeting notes
-   AI moderation
-   AI assistant
-   Agent tools

Priority 5:

-   Certifications + SHA-256 + blockchain anchoring
-   Advanced achievements

Priority 6:

-   Redis
-   RAG
-   Memory
-   Background jobs
-   GCP migration

------------------------------------------------------------------------

## 37. Engineering Rule

Do not implement infrastructure before the product needs it.

The stack should grow in this order:

**RDS PostgreSQL → Socket.IO/WebRTC → Gemini → Redis → RAG/memory →
scalable media infrastructure**

This prevents the prototype from becoming an infrastructure project
instead of a product.
