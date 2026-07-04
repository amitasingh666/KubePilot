# KubePilot — Plain-English Guide

**Version:** 1.0
**Companion to:** all other docs (this one explains them in simple language)
**Who this is for:** anyone who wants to understand KubePilot without knowing Kubernetes or
databases. No jargon assumed — every term is explained the first time it appears.

> **⚠️ Update (2026-07):** For now, KubePilot keeps each customer's data separate using
> **application-layer checks** — the code filters every query by the customer. A stronger
> database-level guarantee (Row-Level Security) is planned for production but not built yet.
> Wherever this guide says "the database itself refuses" cross-tenant reads, read it as
> "planned for production" — today the *application code* enforces it.

---

## 1. What KubePilot does, in one paragraph

Companies run their apps on **Kubernetes** (a system for running lots of software containers on
a group of computers). It's powerful but wasteful — teams usually reserve *way* more computing
power (CPU and memory) than their apps actually use, "just to be safe," and end up paying big
cloud bills for capacity that sits idle. **KubePilot looks at how much a customer's apps really
use, compares it to what they reserved, and tells them exactly what to change to cut the bill —
and how many dollars each change saves.** It only *advises*; it never touches their systems.

---

## 2. The key words (glossary)

Think of it like an apartment building:

| Term | Plain meaning | Analogy |
|---|---|---|
| **Tenant** | One **customer company** that signs up. All their data is walled off from every other customer. | A company renting a floor in our building. "Tenant" = the renter, not a person. |
| **User** | A **person** who logs in (an employee of a tenant). One tenant has many users. | The employees who work on that floor. |
| **Cluster** | One **group of computers** running a customer's apps (they may have several). | One office on the floor. |
| **Node** | One **computer/server** inside a cluster. This is what actually costs money. | One desk in the office. |
| **Workload** | One **app/service** running on the cluster (e.g. "checkout service"). | One team doing a job. |
| **Pod** | One **running copy** of a workload. A workload can run many pods. | One worker on that team. |
| **CPU / Memory request** | How much power an app **reserves** up front (whether it uses it or not). | Renting 5 desks even if only 2 are used. |
| **Usage** | How much the app **actually uses**. | How many desks are actually occupied. |
| **The waste** | request − usage = money paid for nothing. | 3 empty-but-paid-for desks. |
| **Recommendation** | KubePilot's advice: "reserve less / remove this / merge that." | "You only need 2 desks — drop the other 3." |
| **Agent** | A **tiny program we give the customer** to install in their cluster. It reads the numbers and sends summaries to us. | A meter reader who reports usage but can't move anything. |
| **Prometheus** | A tool customers **already have** that records usage numbers over time. We reuse it. | The building's existing electricity meter. |

**Why "multi-tenant" matters:** we run ONE system that serves ALL customers, but each customer
("tenant") can only ever see their own data. That wall is enforced deep in the database (see §6),
not just in the app — so a bug in our code still can't leak one customer's data to another.

---

## 3. How a customer uses KubePilot (the journey)

```
Sign up ─▶ Connect a cluster ─▶ Install the agent ─▶ Wait a few minutes ─▶
See costs & advice ─▶ Apply the changes themselves ─▶ Watch the bill drop
```

**Step 1 — Sign up.** Someone from the company creates an account. This creates their **tenant**
(their private space) and their first **user** (them, as the owner).

**Step 2 — Connect a cluster.** In our dashboard they click "Connect cluster." We generate a
secret **token** (like a password) and show them a one-line install command.

**Step 3 — Install the agent.** They run that command in their cluster. It installs our tiny
**agent**. The agent only has *read* permission — it can look, never change anything.

**Step 4 — The agent starts reporting.** Every few minutes the agent:
- reads **usage** numbers from their existing **Prometheus**,
- reads the **list of apps, computers, and settings** from Kubernetes,
- **strips out anything sensitive** (passwords, private data) so it never leaves their cluster,
- sends a **summary** to us over a secure, one-way connection (their cluster talks to us; we
  never reach into their cluster).

**Step 5 — We analyze.** Our system stores the data, then a scheduled job studies it: "This app
reserves 4 GB but never uses more than 1 GB → recommend 1.3 GB." It bundles all such changes into
one **optimization plan** and calculates the **real dollar savings**.

**Step 6 — They see results.** In the dashboard they see current cost, wasted spend, and a ranked
list of **recommendations** — each with a confidence level, the dollars saved, and a ready-to-use
snippet they can copy.

**Step 7 — They apply changes (themselves).** In version 1, KubePilot only advises. They copy the
snippet and apply it. (A future version can apply changes automatically, with approval.)

**Step 8 — We measure if it worked.** Next time the agent reports, we notice the app was changed,
and we check whether our prediction was right. This keeps our advice honest over time.

---

## 4. End-to-end flow (what happens behind the scenes)

```
 CUSTOMER'S CLUSTER                         KUBEPILOT (our side)
 ┌───────────────────┐                      ┌──────────────────────────────────────────┐
 │  Prometheus (their │                      │                                          │
 │  existing usage    │   reads usage        │   1. Front door checks the token,        │
 │  recorder)         │◀───────┐             │      confirms which customer it is       │
 │                    │        │             │                                          │
 │  Kubernetes (their │        │   sends     │   2. Puts the data in a waiting line      │
 │  app list/settings)│◀──┐    │   summary   │      (a "queue") so nothing is lost       │
 │                    │   │    │   securely  │                                          │
 │   ┌────────────┐   │   │    │   ─────────▶│   3. Workers file the data into the       │
 │   │ our AGENT  │───┼───┴────┘             │      database (usage vs. reservations)    │
 │   └────────────┘   │                      │                                          │
 └───────────────────┘                      │   4. A scheduled "brain" studies the data │
                                             │      and writes RECOMMENDATIONS           │
                                             │                                          │
                                             │   5. A cost step attaches DOLLAR savings  │
                                             │                                          │
                                             │   6. The DASHBOARD shows it to the user   │
                                             │                                          │
                                             │   7. Later, we check if advice was applied│
                                             │      and whether it actually worked       │
                                             └──────────────────────────────────────────┘
```

Plain summary of each numbered step:
1. **Front door (Ingestion API):** checks the secret token + a second security layer, so only the
   real customer can send data, and we know whose it is.
2. **Waiting line (Queue):** incoming data waits in line so a traffic spike never loses anything.
3. **Filers (Workers):** take each item from the line and save it neatly, skipping duplicates.
4. **Brain (Recommendation engine):** runs on a schedule, reads the history, and writes advice —
   carefully, so it never suggests something that would crash an app.
5. **Accountant (Cost engine):** turns each suggestion into real dollars saved.
6. **Dashboard:** the website the customer logs into to see everything.
7. **Report card (feedback loop):** checks later whether the advice was followed and correct.

---

## 5. What data we store (the tables), in plain words

Our database is just a set of **tables** — think spreadsheets. Each row is one thing; each column
is a fact about it. Here are the main ones and what each holds. (Exact column definitions are in
`07-Database-Schema.md`; here we keep it simple.)

### Who's who
- **`tenant`** — one row per **customer company**. Fields: company name, which region their data
  lives in, their plan, active/suspended.
- **`app_user`** — one row per **person** who logs in. Fields: email, name.
- **`membership`** — links a person to a company **and their role** (Owner, Admin, Viewer,
  FinOps). This is how "who can see/do what" works.

### Their setup
- **`cluster`** — one row per **group of computers** they connected. Fields: name, cloud provider
  (AWS/GCP/Azure), region, when we last heard from it, which agent version.
- **`agent_credential`** — the **secret token(s)** for a cluster (stored scrambled, never in
  plain text), so tokens can be rotated safely.
- **`ingestion_snapshot`** — a **receipt** for every batch of data the agent sends, used to avoid
  saving the same thing twice.

### What's running in their cluster (the "inventory")
- **`node`** — each **computer/server**. Fields: size (instance type), how much CPU/memory it has,
  whether it's a cheap "spot" server. *These are what actually cost money.*
- **`workload`** — each **app/service**. Fields: name, how many copies, how much CPU/memory it
  **reserves**, and whether something else already auto-scales it (important — see §7).
- **`container_spec`** — the reservation details **inside** an app (an app can have parts).
- **`workload_revision`** — a **history log** of when an app's reservations changed. This is how
  we later notice "they applied our advice."
- **`scheduling_constraint`, `autoscaler`, `pod_disruption_budget`, `pvc`, `k8s_service`** —
  extra settings that tell us what's *safe* to recommend (e.g. "don't suggest removing this
  computer because these apps can't move off it").

### The actual usage numbers (kept in a fast time-series store)
- **`usage_metric_workload`** — over time, how much each app really used (CPU and memory).
- **`usage_metric_node`** — over time, how busy each computer was.
- **`stability_event`** — records of apps crashing from running out of memory. We use this so we
  **never** recommend a memory cut that would cause another crash.

### The advice and the money
- **`optimization_plan`** — one row per analysis run per cluster. Holds the **single, honest
  total savings number** (we calculate savings once, at the "remove a whole computer" level, so
  we never exaggerate).
- **`recommendation`** — each **individual piece of advice**. Fields: type (cut CPU / cut memory /
  fewer copies / remove computer / delete unused), current vs. proposed, **confidence**, dollars
  saved, and *why* (the numbers behind it).
- **`recommendation_patch`** — the **copy-paste snippet** for each recommendation.
- **`recommendation_outcome`** — the **report card**: was it applied, and did our prediction match
  reality?
- **`pricing_catalog`, `storage_catalog`, `billing_import`, `cost_rollup`** — the **price list**
  (what a server/GB actually costs, including discounts) and pre-added-up costs for fast display.

### Housekeeping
- **`report`** — generated PDF/CSV reports.
- **`audit_log`** — a permanent, unchangeable diary of important actions (who viewed/exported
  what, when a token was rotated). For trust and compliance.

---

## 6. How the tables connect (the golden thread)

Almost everything hangs off **`tenant`**. Follow the arrows — each "───▶" means "belongs to":

```
tenant  ───▶ user (via membership, with a role)
   │
   └──▶ cluster ───▶ node            (the computers)
            │
            └──▶ workload ───▶ container_spec        (an app and its parts)
                     │      ───▶ workload_revision    (its change history)
                     │      ───▶ usage_metric_*       (how much it really used, over time)
                     │      ───▶ autoscaler / constraints (what's safe to change)
                     │
                     └──▶ recommendation ───▶ patch         (advice + the copy-paste snippet)
                                        └──▶ outcome        (did it work?)
                                        (grouped under) optimization_plan  (the honest $ total)
```

**The one rule that makes it safe:** every single table also carries a hidden **`tenant_id`**
column, and the database refuses to return any row whose `tenant_id` doesn't match the
logged-in customer. So even if our code had a bug, one customer physically cannot see another's
data. This is called **Row-Level Security**.

**Reading it as a sentence:** *A customer (**tenant**) has people (**users**) and clusters. Each
cluster has computers (**nodes**) and apps (**workloads**). Each app has usage history and safety
settings. From all that, we produce advice (**recommendations**) bundled into a plan with a real
dollar total, plus a snippet to apply and a later check on whether it worked.*

---

## 7. Two things we're especially careful about (why the extra tables exist)

These caused the biggest fixes in our design, so it's worth knowing why some tables exist:

1. **We never suggest something that crashes an app.** Memory is different from CPU: if an app
   runs out of memory, it *dies*. So for memory we look at the **highest** usage ever seen (plus a
   safety margin), never the "typical" usage — and we check `stability_event` to make sure we
   never suggest a level that already caused a crash before.

2. **We only count savings that are actually real.** In Kubernetes you pay for **computers
   (nodes)**, not for reservations. Reserving less on one app saves $0 by itself — the money only
   appears when the freed-up space lets us **remove a whole computer**. That's why the honest total
   lives on `optimization_plan` and is calculated at the computer level — so our "you'll save $X"
   number holds up.

---

## 8. What "using it" looks like for each kind of person

- **DevOps engineer:** logs in, sees "these 12 apps are over-reserved, here's the fix," copies the
  snippets, applies them.
- **Engineering manager:** sees savings and efficiency trends per team.
- **FinOps / finance:** sees cost broken down by team/app, and exports reports.
- **Owner/Admin:** invites teammates, connects more clusters, manages access.

Everyone only ever sees their own company's data.

---

## 9. One-line recap

> **A customer installs a read-only agent → it safely sends usage summaries → we compare "used vs.
> reserved" → we produce dollar-backed, safe advice in a dashboard → they apply it and save money —
> and every customer's data stays completely separate.**
</content>
