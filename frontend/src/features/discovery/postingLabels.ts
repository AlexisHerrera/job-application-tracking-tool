// How the page names the values of a posting's search fields (discovery.SENIORITY, WORK_MODE…).

export const SENIORITY: Record<string, string> = { junior: "Junior", mid: "Mid", semi_senior: "Semi senior", senior: "Senior", staff_plus: "Staff+", unclear: "Unclear" };
export const COMPANY_SIZE: Record<string, string> = {
  startup: "Startup (<50)",
  small: "Small (50–250)",
  medium: "Medium (250–1k)",
  large: "Large (1k+)",
  unclear: "Unclear",
};
export const SECTOR: Record<string, string> = {
  fintech: "Fintech",
  ai: "AI",
  security: "Security",
  devtools: "Dev tools",
  saas: "SaaS / business software",
  ecommerce: "E-commerce",
  health: "Health",
  education: "Education",
  crypto: "Crypto",
  media: "Media",
  gaming: "Gaming",
  logistics: "Logistics & travel",
  hr: "HR & recruiting",
  government: "Government & non-profit",
  consulting: "Consulting",
  other: "Other",
  unclear: "Unclear",
};
export const WORK_MODE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unclear: "Unclear" };
export const LOCATION_FIT: Record<string, string> = { yes: "Location fits", no: "Location doesn't fit", unclear: "Location unclear" };
export const EMPLOYER: Record<string, string> = { direct: "Hiring directly", agency: "Agency", consultancy: "Consultancy", unclear: "Unclear" };
