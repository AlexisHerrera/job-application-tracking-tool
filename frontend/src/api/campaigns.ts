export interface CampaignSummary {
  id: string;
  name: string;
  started_on: string;
  ended_on: string | null;
  ongoing: boolean;
  notes: string | null;
  day: number;
  applications: number;
  per_week: number;
  first_response_on: string | null;
  first_interview_on: string | null;
  days_to_first_interview: number | null;
}
