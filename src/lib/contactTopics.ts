/** What the contact form can be about (shared by the form and the API). */
export const CONTACT_TOPICS = {
  order: 'Order status',
  payment: 'Payment issue',
  refund: 'Refund request',
  delivery: 'Delivery',
  technical: 'Technical problem',
  partner: 'Becoming a print shop partner',
  feedback: 'Feedback',
  other: 'Something else',
} as const;

export type ContactTopic = keyof typeof CONTACT_TOPICS;
export const CONTACT_TOPIC_KEYS = Object.keys(CONTACT_TOPICS) as [ContactTopic, ...ContactTopic[]];
