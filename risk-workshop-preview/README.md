# CARA RM-1 protected preview

Runtime: Node 24; build: node build.mjs; output: public.
Set Vercel Root Directory for this DEPLOYMENT to risk-workshop-preview.
Do not change the existing project production root.

Preview-only Vercel Deployment Protection must remain enabled. Runtime refuses production.
Required preview variables: RM1_CASE_JSON, RM1_GUIDE_JSON, OPENAI_API_KEY,
KV_REST_API_URL, KV_REST_API_TOKEN. Optional: RISK_WORKSHOP_MODEL.
No participant identity or answer is persisted server-side. Daily IP-derived quota counters expire.

Case text and evaluator keys are stored in preview server environment variables,
not this public repository. Only the public case text is embedded by the build;
evaluator keys are loaded solely by the server handler.

The frontend uses a same-origin protected endpoint. No API address or access-code form.
LearnWorlds production embedding, signed user sessions and cross-device persistence
are separate remaining work. Do not expose this preview through an authentication-bypass link.

Local validation covered syntax, progression, display personalization, and mocked quota/API.
Deployment health confirmed key/quota configuration. Live browser model test pending Vercel MFA.
