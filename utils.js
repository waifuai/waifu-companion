function formatSeconds(seconds) {
  // Calculate days, hours, minutes, and remaining seconds
  const days = Math.floor(seconds / (60 * 60 * 24));
  const hours = Math.floor((seconds % (60 * 60 * 24)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  const remainingSeconds = seconds % 60;

  // Construct the formatted string
  let result = "";
  if (days > 0) result += `${days} day${days > 1 ? "s" : ""} `;
  if (hours > 0) result += `${hours} hour${hours > 1 ? "s" : ""} `;
  if (minutes > 0)
    result += `${minutes} minute${minutes > 1 ? "s" : ""} `;
  if (remainingSeconds > 0 || result === "")
    result += `${remainingSeconds} second${remainingSeconds > 1 ? "s" : ""}`;

  return result.trim();
}

function trackEvent(eventName, params = {}) {
  if (typeof gtag === 'function') {
    gtag('event', eventName, params);
  }
}
window.trackEvent = trackEvent;