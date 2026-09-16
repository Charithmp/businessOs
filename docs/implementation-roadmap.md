# Implementation Roadmap

The codebase uses a modular-monolith API and isolated provider interfaces. Phases are intentionally delivered in the dependency order specified by the source plan.

| Phase | Status | Deliverable |
| --- | --- | --- |
| 0 Foundation | Started | Workspace, containers, API/web baselines, database and CI |
| 1 Identity and tenancy | Started | Data model, scope guard, permission guard, support access model |
| 2 Catalog and subscriptions | Started | Catalog/subscription schema and entitlement resolver contract |
| 3 Logs and observability | Started | Audit/system log models, trace header and redaction utility |
| 4 Website, AI and domains | Planned | Versioned component tree, AI/provider and DNS adapters |
| 5 CRM and WhatsApp | Planned | CRM/inbox data model and webhook adapter |
| 6 Appointments and Zoom | Planned | Calendar domain and meeting adapter |
| 7 Meta and LinkedIn Ads | Planned | OAuth/provider sync workers and local analytics |
| 8 LMS | Planned | Courses, progress and VideoProvider adapter |
| 9 Invoicing | Planned | Business invoice bounded context and PDF output |
| 10 Automation | Planned | Workflow runner, retry/idempotency and event triggers |
| 11 Agency and white label | Planned | Agency control plane and branding/application domains |
| 12 Globalization and payments | Planned | Locale/currency and PaymentProvider abstraction |
| 13 Scale and enterprise | Planned | Worker pools, SSO/SCIM, retention/export and DR exercises |

## Module rule

Every module owns its domain service and adapter interfaces. Cross-module work is emitted as domain events. All new business-owned tables must include `organization_id`, use an organization-scoped repository query, and emit audit events for security or commercial changes.
