AGENTS

Purpose

This file documents the repository's available automated subagents and how maintainers and contributors should use them. Keep this file up to date when agents are added, removed, or their responsibilities change.

Available agents

- Plan
  - One-line description: Researches and outlines multi-step plans for non-trivial tasks.
  - Responsibilities: Break down complex requests into ordered steps, propose approaches, and produce clear next actions or a plan document for follow-up automation.
  - Example tasks: Drafting a migration plan, outlining how to add a new feature, creating a test strategy, or preparing a repository-wide refactor plan.
  - Usage notes: Call this agent when you need a clear, step-by-step plan before implementing changes. Expect a concise plan with milestones and recommended tool calls.

How to call an agent (high-level example)

1. State the goal succinctly (what you want to accomplish). 2. Provide relevant context (files, constraints, desired outputs). 3. Request the agent by name and ask for a plan or actionable output.

Example request (human-friendly): "Plan: produce a 5-step plan to add unit tests for the audio hook, list files to modify, and recommend 2 simple tests." The agent will return a prioritized plan and suggested next actions.

Guidelines for adding new agents

When adding a new agent, update this file and include:
- Name
- One-line description
- Responsibilities (what it can/should do)
- Appropriate example tasks
- Usage notes and limitations
- Security/privacy considerations specific to the agent (if any)

Maintenance & security notes

- Do not send secrets, credentials, or private keys to agents. Treat agents like public-facing services.
- Keep agent descriptions honest about limitations. If an agent may run code or external tools, state that explicitly.
- Update this file whenever agents are changed, added, or removed.

Schema hint for contributors (optional)

When adding entries consider a minimal checklist/fields: name, description, responsibilities, examples, usage_notes, security_notes. Maintain a human-friendly tone.

Placeholder

If you add more agents, append them under "Available agents" with the same structure as the "Plan" entry.
