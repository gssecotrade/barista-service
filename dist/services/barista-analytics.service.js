const events = [];
export function trackEvent(event) {
    events.push(event);
    console.log("[BARISTA_EVENT]", JSON.stringify(event));
}
export function getEvents() {
    return events;
}
