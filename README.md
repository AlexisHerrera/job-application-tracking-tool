# Job Tracker

A personal app that runs my job search: it finds open positions that fit me, and it keeps track of every application from the first email to the offer or rejection, without me typing anything in.

It's a single-user app deployed on AWS behind a login, so only I can use it. This README shows what it does.

https://github.com/user-attachments/assets/336a14d1-ae73-4fec-867e-292ded094769

## Why

A job search spreads across a lot of places: emails from a dozen applicant tracking systems, calendar invites, LinkedIn chats, and job boards full of reposts and roles I can't apply to from Buenos Aires. I wanted one place that collects all of it on its own, and tells me what needs my attention today.

## Discover: finding positions

Every few hours the app collects new postings and keeps the ones that fit my criteria.

- **Sources**: the public job boards of a watchlist of companies (Ashby, Greenhouse and Lever), LATAM job portals (Get on Board, Workable) and remote job feeds. The watchlist was seeded from a scan of thousands of company boards, keeping the companies that hire engineers in Latin America.
- **Two filters**: cheap rules first (location, stack, seniority, blocked companies, duplicates), then an LLM that scores each remaining posting against my profile and explains why it fits or doesn't.
- **Review**: the matches one at a time, as cards, with keyboard shortcuts to save, apply, discard (with a reason) or open the posting.
- **Criteria**: my profile as a form (roles, seniority, stack, where they must hire from) and the rules as editable lists, each showing how many postings it hid.
- **Insights**: how many new postings came in, what I reviewed, and what my discard reasons suggest changing in the rules or the profile.
- **Daily digest**: an email in the morning with the new matches.

https://github.com/user-attachments/assets/4b7040f4-3384-423d-807e-783ea3ffe829

<table>
  <tr>
    <td><img alt="Criteria: the profile the AI reads" src="https://github.com/user-attachments/assets/5945f812-cfcd-4d9f-ab8d-aaf204217fe2" /></td>
    <td><img alt="Criteria: rules with hit counts" src="https://github.com/user-attachments/assets/f51d81e5-df2e-4c28-ab58-8df1b757cd32" /></td>
  </tr>
</table>

<table>
  <tr>
    <td><img alt="Insights: new postings by source" src="https://github.com/user-attachments/assets/920d7d75-2a13-42f0-b9b4-b5a8957c212b" /></td>
    <td><img alt="Insights: reviews and discard reasons" src="https://github.com/user-attachments/assets/b6b4520a-c1b5-4343-8a36-5ddccfb83fcb" /></td>
  </tr>
</table>

## Track: following applications

The app reads my Gmail and Google Calendar (read-only) and builds the applications from them.

- **Email processing**: every 15 minutes it picks out the job-process emails (confirmations, interview invites, assessments, rejections, offers) in English or Spanish, extracts the company, role and event, and attaches each one to the right application. The stage follows from the emails, and an application with no news for a while shows as ghosted.
- **Inbox**: the emails it couldn't match, assigned with one click. It learns the sender for next time.
- **Applications**: a board where dragging a card changes its stage, and a sortable list. Each application opens in a side panel with its timeline, emails, interviews and notes, all editable in place.
- **Add anything by pasting**: a LinkedIn chat, a job post or my own notes. The AI proposes the fields and I review every change before it's saved.
- **Interviews**: from calendar events and invite emails, merged into one, with notes per interview. Reschedules and cancellations update on their own.
- **Dashboard**: what needs a reply, upcoming interviews, applications with no news, and a sankey of where the applications went.
- **Campaigns**: each job-search period with its own stats (applications per week, days to the first interview).

<table>
  <tr>
    <td><img alt="Interviews" src="https://github.com/user-attachments/assets/8519af27-c556-4379-ad7f-e30ed017026a" /></td>
    <td><img alt="Calendar" src="https://github.com/user-attachments/assets/ac1ba2ec-116c-43b3-93f8-20274a73730e" /></td>
  </tr>
</table>

## Privacy

Only job emails are kept, as extracted fields and a short snippet, never the full body. Other emails store only an ID and a verdict. The inbox is opened read-only, so nothing is marked as read, and calendar descriptions are never saved.

## Built with

- **Backend**: Python 3.12, FastAPI, Postgres locally and Aurora DSQL in production. Claude Haiku for classification, extraction and scoring.
- **Frontend**: React, TypeScript, Vite, Tailwind and shadcn/ui.
- **Infrastructure**: AWS Lambda, CloudFront, S3, Cognito and EventBridge Scheduler, managed with Terraform and deployed by GitHub Actions. Built to stay within the free tiers.

Setup, deployment and the CLI are in [`docs/setup.md`](docs/setup.md).
