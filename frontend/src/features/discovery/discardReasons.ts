import { Banknote, Building, CodeXml, Copy, DoorClosed, Ellipsis, FileCheck, FileClock, Ghost, Handshake, HeartCrack, Languages, Link2Off, MapPinOff, Mountain, Shuffle, TrendingDown, type LucideIcon } from "lucide-react";
import type { DiscardReason } from "@/api/discovery";

type ReasonOption = { value: DiscardReason; icon: LucideIcon; label: string; hint: string; detail?: string };

export const QUICK_DISCARD_REASONS: ReasonOption[] = [
  { value: "already_applied", icon: FileCheck, label: "Already applied", hint: "I applied for the same or a similar role at this company", detail: "Same or similar role here" },
  { value: "too_senior", icon: Mountain, label: "Out of my league", hint: "Asks for more years, seniority or skills than I have" },
  { value: "location", icon: MapPinOff, label: "Not for my location", hint: "Can't be hired from where I live" },
  { value: "stack", icon: CodeXml, label: "Wrong stack", hint: "Technologies I don't work with" },
  { value: "role", icon: Shuffle, label: "Not my kind of role", hint: "Different job than the title suggests" },
  { value: "salary", icon: Banknote, label: "Salary too low", hint: "Or not exciting enough" },
];

export const MORE_DISCARD_REASONS: ReasonOption[] = [
  { value: "closed", icon: DoorClosed, label: "Posting closed", hint: "No longer accepting applications" },
  { value: "no_apply", icon: Link2Off, label: "Can't find how to apply", hint: "Broken link or no way in" },
  { value: "fake", icon: Ghost, label: "Fake or spam", hint: "Ghost job, scam or repost farm" },
  { value: "intermediary", icon: Handshake, label: "Agency or consultancy", hint: "Not the real employer" },
  { value: "work_mode", icon: Building, label: "Not remote enough", hint: "Hybrid or on-site" },
  { value: "too_junior", icon: TrendingDown, label: "Too junior", hint: "Below my level" },
  { value: "language", icon: Languages, label: "Language", hint: "Needs a language I don't speak" },
  { value: "contract", icon: FileClock, label: "Contract or hours", hint: "Contractor terms, part-time, time zone" },
  { value: "company", icon: HeartCrack, label: "Not this company", hint: "Company or industry I don't want" },
  { value: "duplicate", icon: Copy, label: "Duplicate posting", hint: "This is another listing for a posting I've already seen" },
  { value: "other", icon: Ellipsis, label: "Other", hint: "Say why in the note" },
];

export const DISCARD_REASONS = [...QUICK_DISCARD_REASONS, ...MORE_DISCARD_REASONS];
export const DISCARD_LABEL = Object.fromEntries(DISCARD_REASONS.map((r) => [r.value, r.label])) as Record<DiscardReason, string>;
