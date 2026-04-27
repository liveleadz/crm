// Source of truth for the 6 LeadPilot USA sub-brands.
// Matches mockup at /Users/sitefyapp/leadpilot-mockups/index.html.

export const BRANDS = [
  { id: 'hp', slug: 'homepro-appointments', name: 'HomePro Appointments', color: 'hp', tone: 'orange' },
  { id: 'vl', slug: 'virgin-leads', name: 'Virgin Leads', color: 'vl', tone: 'pink' },
  { id: 'bs', slug: 'buyer-signals', name: 'Buyer Signals', color: 'bs', tone: 'blue' },
  { id: 'll', slug: 'live-leads', name: 'Live Leads', color: 'll', tone: 'green' },
  { id: 'hb', slug: 'homepro-bids', name: 'HomePro Bids', color: 'hb', tone: 'purple' },
  { id: 'bi', slug: 'buyer-incentives', name: 'Buyer Incentives', color: 'bi', tone: 'amber' },
] as const;

export type BrandId = (typeof BRANDS)[number]['id'];
export type Brand = (typeof BRANDS)[number];
