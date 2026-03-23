type AnalyticsEvent = {
  type:
    | "user_message"
    | "assistant_response"
    | "coffee_recommended"
    | "product_clicked";
  userId: string;
  timestamp: string;
  meta?: Record<string, any>;
};

const events: AnalyticsEvent[] = [];

export function trackEvent(event: AnalyticsEvent) {
  events.push(event);
  console.log("[BARISTA_EVENT]", JSON.stringify(event));
}

export function getEvents() {
  return events;
}
